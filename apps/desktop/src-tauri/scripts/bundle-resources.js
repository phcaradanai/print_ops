const f = require('fs');
const d = 'src-tauri/resources';
f.mkdirSync(d, { recursive: true });
f.cpSync('../web/dist', '../api/dist/static', { recursive: true });
f.cpSync('../api/dist/server.exe', d + '/server.exe');
f.cpSync('../api/dist/static', d + '/static', { recursive: true });
try { f.cpSync('../runner-go/printops-runner.exe', d + '/printops-runner.exe'); } catch (e) { console.log('No runner binary, skipping'); }