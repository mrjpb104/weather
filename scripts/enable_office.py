#!/usr/bin/env python3
"""Turn on plain-English summaries for an NWS office: add it to config.json and save its discussion.

Run by .github/workflows/enable-summaries.yml when the repo owner opens an issue titled
"Enable summaries: <OFFICE>" (the weather app's "Turn on summaries" button prefills one),
or by hand from the Actions tab.

Reads ISSUE_TITLE / ISSUE_BODY, or INPUT_OFFICE / INPUT_LOCATION / INPUT_COORDS.
Writes office=, name=, status= (added | already) to $GITHUB_OUTPUT.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import save_discussions  # noqa: E402

ROOT = save_discussions.ROOT
CONFIG = os.path.join(ROOT, 'config.json')


def field(body, name):
    m = re.search(rf'^\s*{name}\s*:\s*(.+?)\s*$', body or '', re.M | re.I)
    return m.group(1) if m else ''


def clean(s, n=80):
    return re.sub(r"[^\w .,'()/-]", '', s or '', flags=re.U).strip()[:n]


def output(**kv):
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
            for k, v in kv.items():
                f.write(f'{k}={v}\n')
    print(kv)


def main():
    title, body = os.environ.get('ISSUE_TITLE', ''), os.environ.get('ISSUE_BODY', '')
    office = os.environ.get('INPUT_OFFICE') or (re.search(r'enable summaries\s*:?\s*([A-Za-z]{3})\b', title, re.I) or [None, ''])[1]
    office = office.strip().upper()
    if not re.fullmatch(r'[A-Z]{3}', office):
        sys.exit(f'Could not find a three-letter NWS office ID in {title!r}.')
    location = clean(os.environ.get('INPUT_LOCATION') or field(body, 'Location'))
    coords = os.environ.get('INPUT_COORDS') or field(body, 'Coordinates')
    m = re.search(r'(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)', coords or '')
    latlon = f'{float(m.group(1)):.2f}, {float(m.group(2)):.2f}' if m else ''

    with open(CONFIG) as f:
        cfg = json.load(f)
    if office in cfg.get('summary_offices', []) and office in cfg.get('office_focus', {}):
        output(office=office, name=cfg['office_focus'][office].get('name') or office, status='already')
        return

    # Confirm the office exists and get its name from its latest discussion.
    new, _ = save_discussions.save(office)
    with open(os.path.join(save_discussions.OUT, f'{office}.json')) as f:
        disc = json.load(f)
    area = disc.get('office_name') or clean(field(body, 'Area')) or office  # e.g. "Seattle WA"
    name = re.sub(r'\s+[A-Z]{2}$', '', area).split('/')[0].strip() or office  # "Seattle"

    with open(CONFIG) as f:
        cfg = json.load(f)
    offices = cfg.setdefault('summary_offices', [])
    focus = cfg.setdefault('office_focus', {})
    if office in offices and office in focus:
        output(office=office, name=name, status='already')
        return
    if office not in offices:
        offices.append(office)
    if office not in focus:
        where = f'{location} ({latlon})' if location and latlon else location or latlon
        focus[office] = {
            'name': name,
            'focus': (f'the area around {where} first, then the rest of the forecast area briefly' if where
                      else 'the most populated parts of the forecast area first, then the rest briefly'),
        }
    with open(CONFIG, 'w') as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
        f.write('\n')
    output(office=office, name=name, status='added')


if __name__ == '__main__':
    main()
