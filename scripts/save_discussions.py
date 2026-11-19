#!/usr/bin/env python3
"""Save the latest NWS Area Forecast Discussion (AFD) for each office into discussions/<OFFICE>.json.

Run hourly by .github/workflows/save-discussions.yml. The scheduled Claude task that writes
summaries/<OFFICE>.json reads these files from the repo instead of fetching from the web.

Usage: save_discussions.py [OFFICE ...]   (default: every office in config.json "summary_offices")

Both api.weather.gov and the Iowa Environmental Mesonet archive are checked and the newer
issuance wins, so one source serving a stale copy doesn't hold the file back.
A file is rewritten only when a new discussion has been issued.
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'discussions')
UA = 'mrjpb104-weather/1.0 (https://github.com/mrjpb104/weather)'
TZ = {'HST': -10, 'HDT': -9, 'AKST': -9, 'AKDT': -8, 'PST': -8, 'PDT': -7, 'MST': -7, 'MDT': -6,
      'CST': -6, 'CDT': -5, 'EST': -5, 'EDT': -4, 'AST': -4, 'ADT': -3, 'SST': -11, 'CHST': 10, 'GMT': 0, 'UTC': 0}
MONTHS = {m: i + 1 for i, m in enumerate('JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split())}


def get(url, as_json=True, tries=2):
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/geo+json' if as_json else 'text/plain'})
            with urllib.request.urlopen(req, timeout=15) as r:
                body = r.read().decode('utf-8', 'replace')
            return json.loads(body) if as_json else body
        except Exception as e:  # noqa: BLE001 — retry any network/parse error
            err = e
            if i < tries - 1:
                time.sleep(2)
    raise err


def looks_like_afd(text):
    return bool(text and text.strip()) and 'area forecast discussion' in text.lower()


def iso(d):
    return d.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def issued_from_text(text):
    """Parse the local issuance line, e.g. '1234 PM PST Mon Nov 16 2026'."""
    m = re.search(r'^\s*(\d{3,4}) (AM|PM) ([A-Z]{2,4}) [A-Z]{3} ([A-Z]{3}) (\d{1,2}) (\d{4})\s*$', text.upper(), re.M)
    if not m or m.group(3) not in TZ:
        return None
    hhmm, ampm, tz, mon, day, year = m.groups()
    h, mi = int(hhmm[:-2]), int(hhmm[-2:])
    h = h % 12 + (12 if ampm == 'PM' else 0)
    local = dt.datetime(int(year), MONTHS[mon], int(day), h, mi, tzinfo=dt.timezone(dt.timedelta(hours=TZ[tz])))
    return local


def from_nws(office):
    items = get(f'https://api.weather.gov/products/types/AFD/locations/{office}').get('@graph') or []
    if not items:
        raise RuntimeError('api.weather.gov lists no discussions')
    p = get(f"https://api.weather.gov/products/{items[0]['id']}")
    issued = dt.datetime.fromisoformat(p['issuanceTime'].replace('Z', '+00:00'))
    if not looks_like_afd(p.get('productText')):
        raise RuntimeError('api.weather.gov returned an empty or unexpected product')
    return {'source': 'api.weather.gov', 'product_id': p.get('id'), 'issued': issued, 'text': p['productText']}


def from_iem(office):
    text = get(f'https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py?pil=AFD{office}&fmt=text&limit=1&order=desc', as_json=False)
    issued = issued_from_text(text)
    if not issued or not looks_like_afd(text):
        raise RuntimeError('IEM returned no parsable discussion')
    return {'source': 'mesonet.agron.iastate.edu', 'product_id': None, 'issued': issued, 'text': text.strip() + '\n'}


def office_name(text):
    m = re.search(r'National Weather Service (.+)', text)
    return m.group(1).strip() if m else None


def save(office):
    found, errors = [], []
    for fn in (from_nws, from_iem):
        try:
            found.append(fn(office))
        except Exception as e:  # noqa: BLE001
            errors.append(f'{fn.__name__}: {e}')
    if not found:
        raise RuntimeError('; '.join(errors))
    best = max(found, key=lambda x: x['issued'])
    path = os.path.join(OUT, f'{office}.json')
    try:
        with open(path) as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    # Only move forward: never replace a saved discussion with an older one (e.g. one source lagging while the other is down).
    if old.get('issued') and iso(best['issued']) <= old['issued']:
        return False, old['issued']
    doc = {
        'office': office,
        'office_name': office_name(best['text']),
        'issued': iso(best['issued']),
        'saved': iso(dt.datetime.now(dt.timezone.utc)),
        'source': best['source'],
        'product_id': best['product_id'],
        'text': best['text'],
    }
    os.makedirs(OUT, exist_ok=True)
    with open(path, 'w') as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write('\n')
    return True, doc['issued']


def main(argv):
    with open(os.path.join(ROOT, 'config.json')) as f:
        offices = argv or json.load(f).get('summary_offices', [])
    valid = []
    for office in offices:
        office = office.strip().upper()
        if re.fullmatch(r'[A-Z]{3}', office):
            valid.append(office)
        else:
            print(f'::warning::Skipping invalid office ID {office!r}')

    def run(office):
        try:
            return office, save(office), None
        except Exception as e:  # noqa: BLE001
            return office, None, e

    # Offices in parallel, so one slow source can't push the job past its time limit.
    changed, failed = [], []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for office, res, err in pool.map(run, valid):
            if err:
                print(f'::warning::{office}: {err}')
                failed.append(office)
                continue
            new, issued = res
            print(f"{office}: {'saved new discussion' if new else 'unchanged'} (issued {issued})")
            if new:
                changed.append(office)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
            f.write(f"changed={' '.join(changed)}\n")
    # A brief outage for one office isn't worth a failed run (and an email); fail only if every office failed.
    if valid and len(failed) == len(valid):
        print('::error::Could not fetch a discussion for any office')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
