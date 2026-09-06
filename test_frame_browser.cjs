/* Run with Node + Playwright installed. Fixtures never contact a device or cloud. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const output = process.env.FRAME_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'dash-frame-browser-'));
fs.mkdirSync(output, { recursive: true });
const imageId = 'a'.repeat(64);
const secondId = 'b'.repeat(64);
const thirdId = 'c'.repeat(64);
let apiOffline = false;
let frameOffline = false;
let actions = [];
let prefs = {};
let photos = [];
let activatedAt = Date.now();
let rotationSeconds = 900;
let timer = { type:'timer', running:false, minutes:5, seconds:0, set_minutes:5, time_text:'05:00', flash:false };
let music = { type:'spotify', authenticated:true, track_name:'', artist_name:'', album_art_url:'', is_playing:false, progress_ms:0, duration_ms:240000 };
let temperature = 72;
let counter = 0;
let mode = 'on';

function snapshot() {
  const now = new Date();
  const time = { time_main:'10:24', seconds:String(now.getSeconds()).padStart(2,'0'), day:5, month:'SEP', year:2026, day_name:'SATURDAY' };
  return { generated_at:now.toISOString(), version:'browser-fixture', display_mode:mode,
    phone_state:{sleep_focus:false,is_home:true}, motion:{motion_detected:true,display_off:mode==='off',display_dimmed:mode==='dim'},
    settings:{}, spotify_status:{configured:true,authenticated:true}, convex_status:{enabled:false},
    widgets:{ time, timer:{...timer}, weather:{type:'weather',temperature_f:temperature,condition:'Partly cloudy',location:'New York',weather_code:2,is_day:1,forecast:[]},
      click_counter:{type:'click_counter',count:counter}, motion_status:{}, photo:{has_image:false} },
    apps:{spotify:{...music}} };
}
const scenery = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#6c8997"/><stop offset="1" stop-color="#cfbbb0"/></linearGradient><linearGradient id="m"><stop stop-color="#315853"/><stop offset="1" stop-color="#638071"/></linearGradient></defs><path fill="url(#s)" d="M0 0h1600v1000H0z"/><circle cx="1220" cy="225" r="85" fill="#f8e5b4"/><path fill="#80918c" d="M0 640L260 355 510 625 815 315 1110 605 1410 360 1600 550v450H0z"/><path fill="url(#m)" d="M0 805L220 680 430 835 810 540 1000 785 1270 595 1600 775v225H0z"/><path fill="#29413c" d="M0 930Q470 675 920 910T1600 860v140H0z"/></svg>`;
const portrait = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1400"><rect width="800" height="1400" fill="#d2c7b1"/><rect x="270" y="200" width="360" height="1100" rx="180" fill="#6d7d60"/><circle cx="400" cy="360" r="120" fill="#b49c7b"/><path d="M0 1160Q300 930 800 1150v250H0" fill="#7c735e"/></svg>`;
const busy = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><pattern id="p" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="80" height="80" fill="#f8edca"/><circle cx="40" cy="40" r="30" fill="#bc683b"/><path d="M0 0L80 80M80 0L0 80" stroke="#614c38" stroke-width="10"/></pattern></defs><rect width="1600" height="900" fill="url(#p)"/></svg>`;
const photoSet = [
  {id:imageId,url:'/fixture-landscape.svg',width:1600,height:1000},
  {id:secondId,url:'/fixture-portrait.svg',width:800,height:1400},
  {id:thirdId,url:'/fixture-busy.svg',width:1600,height:900},
];

const server = http.createServer(async(req,res) => {
  const url = new URL(req.url, 'http://localhost');
  function json(value,status=200) { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value)); }
  if(url.pathname==='/api/wide/state') return json(snapshot(),apiOffline?503:200);
  if(url.pathname==='/api/frame/photos') return json({batch_id:photos.length?'fixture-batch':null,activated_at:activatedAt,rotation_seconds:rotationSeconds,photos,photo_preferences:prefs,status:{configured:true,syncing:false,last_error:null,last_sync:Date.now()}},frameOffline?503:200);
  if(url.pathname==='/api/frame/config') {
    if(req.method==='POST') {
      let raw='';for await(const chunk of req) raw+=chunk;
      const value=JSON.parse(raw);
      if(value.photo_preferences) prefs={...prefs,...value.photo_preferences};
    }
    return json({cloud_url:'https://fixture.convex.site',token_configured:true,photo_preferences:prefs,rotation_seconds:900});
  }
  if(url.pathname==='/api/wide/config') return json({slots:['weather','spotify']});
  if(url.pathname==='/api/wide/action') {
    let raw='';for await(const chunk of req) raw+=chunk;
    const value=JSON.parse(raw);actions.push(value);
    if(value.action==='activity') mode='on';
    if(value.action==='spotify_toggle') music.is_playing=!music.is_playing;
    if(value.action==='timer_toggle') timer.running=!timer.running;
    if(value.action==='timer_reset') timer={...timer,running:false,minutes:5,seconds:0,time_text:'05:00'};
    if(value.action==='counter_inc') counter++;
    if(value.action==='counter_dec') counter--;
    if(value.action==='counter_reset') counter=0;
    return json(snapshot());
  }
  if(url.pathname.startsWith('/fixture-')) {
    res.writeHead(200,{'Content-Type':'image/svg+xml'});
    return res.end(url.pathname.includes('portrait')?portrait:url.pathname.includes('busy')?busy:scenery);
  }
  const rel=url.pathname==='/wide'?'wide.html':url.pathname==='/frame-setup'?'frame-setup.html':url.pathname.slice(1);
  const file=path.join(__dirname,'web',rel);
  if(!file.startsWith(path.join(__dirname,'web')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()) {res.writeHead(404);return res.end();}
  const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.otf':'font/otf','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime});fs.createReadStream(file).pipe(res);
});

async function main() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // No cloud, music-service, or production-device requests are permitted by this fixture.
  await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  async function shot(name) { await page.screenshot({path:path.join(output,`${name}.png`)}); }
  async function settle(ms=650) { await page.waitForTimeout(ms); }
  async function reloadFrame() { await page.goto(base+'/wide');await settle(1000); }
  async function apps() { await page.locator('#dashboardView').click({position:{x:700,y:260}});await page.locator('#btnOpenApps').click(); }
  async function closeApp() { await page.locator('#btnBackToDash').click();await settle(); }
  try {
    await reloadFrame();
    assert.equal(await page.locator('#dashboardGrid').count(),0);
    assert.match(await page.locator('#frameTime').innerText(),/^\d{1,2}:\d{2}$/);
    assert.equal(await page.locator('#frameMusic').isVisible(),false);
    assert.equal(await page.locator('#frameTimer').isVisible(),false);
    await settle(4000);await shot('01-empty-idle');
    assert.equal(await page.locator('#frameChrome').evaluate(el=>Number(getComputedStyle(el).opacity)),0);

    photos=[photoSet[0]];await reloadFrame();
    await page.waitForFunction(()=>[...document.querySelectorAll('.frame-photo')].some(el=>el.classList.contains('is-active')&&el.naturalWidth));
    await settle(1600);await shot('02-photo-idle');
    assert.equal(actions.length,0,'Background rendering must not send hardware activity');

    music={...music,track_name:'First song',artist_name:'First artist',album_art_url:'/fixture-landscape.svg',is_playing:true};
    timer={...timer,running:true,minutes:2,seconds:35,time_text:'02:35'};
    await settle();
    assert.equal(await page.locator('#frameMusic').isVisible(),true);
    assert.equal(await page.locator('#frameTimer').isVisible(),true);
    assert.equal(await page.locator('#appOverlayView').isVisible(),false,'Playback must not auto-open Spotify');
    await shot('03-live-activities');
    music={...music,track_name:'Second song',artist_name:'Second artist',album_art_url:'/fixture-portrait.svg'};
    await settle();
    assert.equal(await page.locator('#frameMusicTitle').innerText(),'Second song');
    assert.equal(await page.locator('#frameMusicArtist').innerText(),'Second artist');
    assert.match(await page.locator('#frameMusicArt').getAttribute('src'),/portrait/);
    await page.locator('#frameMusicToggle').click();await settle();
    assert.equal(music.is_playing,false);
    assert.equal(await page.locator('#frameMusic').isVisible(),true);

    await page.locator('#frameTimerOpen').click();await settle();
    timer={...timer,minutes:2,seconds:31,time_text:'02:31'};
    await settle();
    assert.match(await page.locator('#appOverlayContent').innerText(),/02:31/,'Open timer must update without a Spotify change');
    timer={...timer,running:false};await settle();await closeApp();
    assert.equal(await page.locator('#frameTimer').isVisible(),true);
    timer={...timer,minutes:0,seconds:0,time_text:'00:00'};await settle();
    const beforeDismiss=actions.length;
    await page.locator('#frameTimerAction').click();await settle();
    assert.equal(await page.locator('#frameTimer').isVisible(),false);
    assert.equal(actions.length,beforeDismiss,'Timer dismissal must stay web-only');

    await apps();await shot('04-apps');
    await page.locator('[data-app="photos"]').click();await settle();await shot('05-photos');
    assert.match(await page.locator('#appOverlayContent').innerText(),/crop/i);
    await closeApp();

    apiOffline=true;frameOffline=true;await settle(3000);await shot('06-offline');
    assert.equal(await page.locator('.frame-photo.is-active').isVisible(),true);
    assert.equal(await page.locator('#connectionLostOverlay').isVisible(),false);
    apiOffline=false;frameOffline=false;await settle();
    temperature=81;await page.locator('#frameWeather').click();await settle();
    temperature=84;await settle();
    assert.match(await page.locator('#appOverlayContent').innerText(),/84/,'Weather must update independently of Spotify');
    await closeApp();

    for(const [label,photo] of [['portrait',photoSet[1]],['busy',photoSet[2]]]) {
      photos=[photo];await reloadFrame();await settle(1800);await shot(`07-${label}`);
      const bounds=await page.locator('#frameClock').boundingBox();
      assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1280&&bounds.y+bounds.height<690);
    }
    await page.setViewportSize({width:1024,height:600});await settle();await shot('08-small-landscape');
    mode='off';await settle();assert.equal(await page.locator('#displayOffOverlay').isVisible(),true);
    await page.locator('#displayOffOverlay').click();await settle();assert.equal(mode,'on');

    // Verify per-photo edits through the real editor and preserve other photos.
    photos=[photoSet[0],photoSet[1]];activatedAt=Date.now();
    await page.setViewportSize({width:1280,height:800});await reloadFrame();
    await apps();await page.locator('[data-app="photos"]').click();await settle();
    await page.locator('[data-photo-id="'+imageId+'"]').click();
    await page.locator('#frameClockChoice').selectOption('top-right');
    await page.locator('#frameCropX').evaluate(el=>{el.value='25';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#frameSavePhoto').click();await settle();
    assert.equal(prefs[imageId].position_x,25);
    assert.equal(prefs[imageId].clock,'top-right');
    await page.locator('[data-photo-id="'+secondId+'"]').click();
    await page.locator('#frameClockChoice').selectOption('middle-right');
    await page.locator('#frameSavePhoto').click();await settle();
    assert.equal(prefs[imageId].clock,'top-right');
    assert.equal(prefs[secondId].clock,'middle-right');
    await page.locator('#frameResetPhoto').click();await settle();
    assert.deepEqual(prefs[secondId],{});
    assert.equal(prefs[imageId].clock,'top-right');
    await closeApp();
    await page.locator('#dashboardView').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#btnOpenApps').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Enter');await settle();
    assert.equal(await page.locator('#frameAppsDialog').evaluate(el=>el.open),true);
    await page.keyboard.press('Escape');await settle();
    assert.equal(await page.locator('#frameAppsDialog').evaluate(el=>el.open),false);
    assert.equal(await page.locator('#btnOpenApps').evaluate(el=>el===document.activeElement),true);

    // A controlled browser clock exercises real scheduling without a 15-minute wait.
    await page.clock.install({time:new Date()});
    activatedAt=Date.now();prefs={};photos=photoSet;
    await reloadFrame();
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/landscape/);
    await page.clock.fastForward(900001);await settle(1700);
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/portrait/);
    await reloadFrame();
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/portrait/,'Reload must retain scheduled photo');
    apiOffline=true;
    const beforeMinute=await page.locator('#frameTime').innerText();
    await page.clock.fastForward(65000);await settle();
    assert.notEqual(await page.locator('#frameTime').innerText(),beforeMinute,'Offline clock must keep advancing');
    assert.equal(await page.locator('.frame-photo.is-active').isVisible(),true);
    apiOffline=false;

    assert.equal(errors.length,0,errors.join('\n'));
    console.log(`Browser scenarios passed. Screenshots: ${output}`);
  } finally { await browser.close();server.close(); }
}
main().catch(error=>{console.error(error);console.log(`Screenshots: ${output}`);server.close();process.exitCode=1;});
