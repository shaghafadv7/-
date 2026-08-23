const {app,BrowserWindow,dialog} = require('electron');
const path = require('path');
const fs = require('fs');

const hasLock=app.requestSingleInstanceLock();
if(!hasLock){app.quit();}

let win=null;
let localServer=null;
let quitting=false;

function writableRoot(){
  return app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname,'..');
}
function startLocalEngine(){
  if(localServer) return;
  const root=writableRoot();
  const data=path.join(root,'data');
  const uploads=path.join(root,'uploads');
  fs.mkdirSync(data,{recursive:true});
  fs.mkdirSync(uploads,{recursive:true});
  process.env.BAYAT_DATA_DIR=data;
  process.env.BAYAT_UPLOAD_DIR=uploads;
  process.env.PORT='4173';
  localServer=require('../server').httpServer;
  localServer.on('error',e=>dialog.showErrorBox('خطأ في تشغيل قاعدة البيانات',e.code==='EADDRINUSE'?'هناك نسخة أخرى من التطبيق ما زالت تعمل. أغلقها من إدارة المهام ثم افتح البرنامج مجددًا.':e.message));
}
function createWindow(){
  if(win && !win.isDestroyed()){win.show();win.focus();return;}
  const iconPath = require('path').join(__dirname,'..','public','icon.png');
  win=new BrowserWindow({
    width:1440,height:900,minWidth:1050,minHeight:700,
    backgroundColor:'#f5f6f8',autoHideMenuBar:true,
    icon: require('fs').existsSync(iconPath) ? iconPath : undefined,
    title:'Bayat Alakena Real Estate',
    webPreferences:{contextIsolation:true,sandbox:true}
  });
  // مهلة قصيرة لضمان جاهزية المحرك المحلي قبل فتح الواجهة.
  setTimeout(()=>win && !win.isDestroyed() && win.loadURL('http://127.0.0.1:4173').catch(e=>dialog.showErrorBox('تعذر فتح التطبيق',e.message)),350);
  win.on('closed',()=>{win=null});
}

if(hasLock){
  app.on('second-instance',()=>{
    // إذا بقي المحرك في الخلفية بعد إغلاق النافذة، يعيد الضغط على الأيقونة فتحها.
    if(!win || win.isDestroyed()) createWindow();
    else {if(win.isMinimized())win.restore();win.show();win.focus();}
  });
  app.whenReady().then(()=>{
    try{startLocalEngine();createWindow()}catch(e){dialog.showErrorBox('خطأ في تشغيل قاعدة البيانات',e.message);app.quit()}
  });
}
app.on('window-all-closed',()=>{
  quitting=true;
  if(localServer) localServer.close(()=>app.quit());
  else app.quit();
  // ضمان عدم بقاء عملية مخفية تمنع التشغيل مرة أخرى.
  setTimeout(()=>app.exit(0),1000);
});
app.on('before-quit',()=>{quitting=true});
