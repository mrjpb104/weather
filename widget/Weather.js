// Variables used by Scriptable.
// icon-color: deep-blue; icon-glyph: cloud-sun;
// Weather widget loader: downloads the latest widget code from your site, then runs it.
// Parameter (Edit Widget → Parameter): blank = Home · "here" = current location · "lat,lon|Name"
const CODE_URL = 'https://mrjpb104.github.io/weather/widget/core.js';
const fm = FileManager.local();
const dir = module.filename.split('/').slice(0, -1).join('/');
const path = fm.joinPath(dir, 'weather-widget-core.js');
try {
  const r = new Request(`${CODE_URL}?t=${Date.now()}`);
  r.timeoutInterval = 15;
  const code = await r.loadString();
  if (code.includes('module.exports.run')) fm.writeString(path, code);
} catch (e) { /* offline: use the last downloaded copy */ }
if (!fm.fileExists(path)) throw new Error('Could not download the widget code. Check your connection and run the script again.');
await importModule('weather-widget-core').run(args.widgetParameter);
