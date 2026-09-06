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
const foregroundFixtures = new Map();
let foregroundUnavailable = false;
let timer = { type:'timer', running:false, minutes:5, seconds:0, set_minutes:5, time_text:'05:00', flash:false };
let music = { type:'spotify', authenticated:true, track_name:'', artist_name:'', album_art_url:'', is_playing:false, progress_ms:0, duration_ms:240000 };
let temperature = 72;
let counter = 0;
let mode = 'on';
let phoneState = { sleep_focus:false, is_home:true, focus_mode:'none' };

function snapshot() {
  const now = new Date();
  const time = { time_main:'10:24', seconds:String(now.getSeconds()).padStart(2,'0'), day:5, month:'SEP', year:2026, day_name:'SATURDAY' };
  return { generated_at:now.toISOString(), version:'browser-fixture', display_mode:mode,
    phone_state:{...phoneState}, motion:{motion_detected:mode==='on',display_off:mode==='off',display_dimmed:mode==='dim'},
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
  if (url.pathname.startsWith('/foreground-')) {
    if (foregroundUnavailable || !foregroundFixtures.has(url.pathname)) {res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':'image/png'});return res.end(foregroundFixtures.get(url.pathname));
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
  const context=await browser.newContext({viewport:{width:1280,height:800},hasTouch:true});
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
    if (!process.env.FRAME_TEST_DEPTH_ONLY) {
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
    assert.equal(await page.locator('#appOverlayView').isVisible(),true,'Playback start opens Spotify');
    assert.equal(await page.locator('#appOverlayView').evaluate(el=>el.classList.contains('spotify-active')),true);
    await closeApp();await settle();
    assert.equal(await page.locator('#appOverlayView').isVisible(),false,'Returning to photos is respected during playback');
    await shot('03-live-activities');
    music={...music,track_name:'Second song',artist_name:'Second artist',album_art_url:'/fixture-portrait.svg'};
    await settle();
    assert.equal(await page.locator('#appOverlayView').isVisible(),false,'Track changes do not reopen Spotify');
    assert.equal(await page.locator('#frameMusicTitle').innerText(),'Second song');
    assert.equal(await page.locator('#frameMusicArtist').innerText(),'Second artist');
    assert.match(await page.locator('#frameMusicArt').getAttribute('src'),/portrait/);
    await page.locator('#frameMusicToggle').click();await settle();
    assert.equal(music.is_playing,false);
    assert.equal(await page.locator('#frameMusic').isVisible(),true);

    await page.locator('#frameMusicToggle').click();await settle();
    assert.equal(music.is_playing,true);
    assert.equal(await page.locator('#appOverlayView').evaluate(el=>el.classList.contains('spotify-active')),true,'Resuming opens Spotify again');
    await closeApp();
    music.is_playing=false;await settle();
    await page.locator('#btnOpenSettings').click();await settle();
    music.is_playing=true;await settle();
    assert.equal(await page.locator('#settingsOverlayView').isVisible(),true,'Playback does not interrupt settings edits');
    await page.locator('#btnCloseSettings').click();await settle();
    assert.equal(await page.locator('#appOverlayView').evaluate(el=>el.classList.contains('spotify-active')),true,'Deferred playback opens after leaving settings');
    await closeApp();
    music.is_playing=false;await settle();

    await page.locator('#frameTimerOpen').click();await settle();
    assert.equal(await page.locator('#appContainer').evaluate(el=>el.inert),true,'Polling preserves modal focus isolation');
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
      assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1280&&bounds.y+bounds.height<=800);
    }
    await page.setViewportSize({width:1024,height:600});await settle();await shot('08-small-landscape');
    const beforeDisplayActions=actions.length;
    for(const hardwareMode of ['dim','off']) {
      mode=hardwareMode;await settle();
      assert.equal(await page.locator('#displayOffOverlay').isVisible(),false,'Home with no Sleep Focus must ignore OLED motion sleep');
      assert.equal(await page.locator('#appContainer').evaluate(el=>el.inert),false);
    }
    await page.locator('#dashboardView').click({position:{x:500,y:240}});await settle();
    assert.equal(mode,'off','Photo taps must not wake the OLED');
    assert.equal(actions.length,beforeDisplayActions);
    assert.equal(await page.getByText('Tap anywhere to wake').count(),0);
    phoneState.is_home=false;await settle();
    assert.equal(await page.locator('#displayOffOverlay').isVisible(),true,'Away still covers the web view');
    assert.equal(await page.locator('#appContainer').evaluate(el=>el.inert),true);
    await page.locator('#displayOffOverlay').click();await settle();
    assert.equal(await page.locator('#displayOffOverlay').isVisible(),true,'Taps do not override phone presence');
    assert.equal(actions.length,beforeDisplayActions);
    phoneState.is_home=true;await settle();
    assert.equal(await page.locator('#displayOffOverlay').isVisible(),false,'Returning home restores the frame even while the OLED is off');
    await apps();
    phoneState.sleep_focus=true;await settle();
    assert.equal(await page.locator('#frameAppsDialog').evaluate(el=>el.open),false);
    assert.equal(await page.locator('#displayOffOverlay').isVisible(),true,'Sleep Focus still covers the web view');
    phoneState.sleep_focus=false;phoneState.focus_mode='sleep';await settle();
    assert.equal(await page.locator('#displayOffOverlay').isVisible(),true);
    phoneState.focus_mode='none';await settle();
    assert.equal(await page.locator('#displayOffOverlay').isVisible(),false);
    assert.equal(actions.length,beforeDisplayActions,'Web visibility must not change hardware state');
    await shot('09-home-with-oled-off');

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

    // Bottom clock choices persist through the editor and share space with both activities.
    await page.goto('about:blank');
    photos=[photoSet[0]];activatedAt=Date.now();
    music={...music,is_playing:true,track_name:'Second song'};
    timer={...timer,running:true,minutes:2,seconds:35,time_text:'02:35'};
    await reloadFrame();
    async function assertComposition(label) {
      const boxes=[];
      const viewport=page.viewportSize();
      for(const id of ['frameClock','frameWeather','frameMusic','frameTimer']) {
        if(!await page.locator('#'+id).isVisible()) continue;
        const b=await page.locator('#'+id).boundingBox();
        assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=viewport.width+1&&b.y+b.height<=viewport.height+1,`${label}: ${id} inside viewport ${JSON.stringify(b)}`);
        for(const [other,a] of boxes) assert.ok(b.x+b.width<=a.x+1||a.x+a.width<=b.x+1||b.y+b.height<=a.y+1||a.y+a.height<=b.y+1,`${label}: ${id} overlaps ${other}`);
        boxes.push([id,b]);
      }
    }
    for(const position of ['bottom-left','bottom-center','bottom-right']) {
      await page.setViewportSize({width:1280,height:800});
      await apps();await page.locator('[data-app="photos"]').click();await settle();
      await page.locator('#frameClockChoice').selectOption(position);
      await page.locator('#frameSavePhoto').click();await settle();
      assert.equal(prefs[imageId].clock,position);
      assert.equal(await page.locator('#framePreviewClock').getAttribute('data-position'),position);
      await closeApp();await settle();
      for(const size of [{width:1280,height:800},{width:1024,height:600},{width:800,height:480},{width:390,height:844}]) {
        await page.setViewportSize(size);await settle(1100);
        assert.equal(await page.locator('#frameClock').getAttribute('data-position'),position);
        await assertComposition(position+' '+size.width);
        await shot('bottom-'+position+'-'+size.width);
      }
      const anchored=await page.locator('#frameClock').boundingBox();
      music.track_name='';timer={...timer,running:false,minutes:5,seconds:0,time_text:'05:00'};await settle();
      assert.deepEqual(await page.locator('#frameClock').boundingBox(),anchored,'Clock stays anchored when activities disappear');
      await assertComposition(position+' idle');
      music.track_name='Second song';timer={...timer,running:true,minutes:2,seconds:35,time_text:'02:35'};await settle();
    }
    await page.setViewportSize({width:1280,height:800});

    }
    // Genuine transparent PNG fixtures; RGB deliberately differs from the photo.
    // The renderer must use their alpha without introducing color/lighting seams.
    for(const [name,width,height] of [['landscape',1600,1000],['portrait',800,1400]]) {
      const data=await page.evaluate(({width,height})=>{
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#ff00ff';
        ctx.fillRect(width*.04,height*.04,width*.66,height*.55);
        return canvas.toDataURL('image/png').split(',')[1];
      },{width,height});
      foregroundFixtures.set('/foreground-'+name+'.png',Buffer.from(data,'base64'));
    }
    const depthPhotos=photoSet.slice(0,2).map((photo,i)=>({...photo,foreground:{id:(i?'e':'d').repeat(64),url:'/foreground-'+(i?'portrait':'landscape')+'.png',width:photo.width,height:photo.height}}));
    // Cutouts may arrive after commit. Refresh in place without resetting a tap's timer.
    photos=photoSet.slice(0,2);prefs={[secondId]:{clock:'top-right',depth:true}};
    activatedAt=Date.now();await reloadFrame();await settle(1500);
    await page.locator('#dashboardView').click({position:{x:600,y:260}});await settle(1500);
    assert.equal(await page.locator('.frame-photo.is-active').getAttribute('src'),photoSet[1].url);
    const savedRotation=await page.evaluate(()=>{window.lateCutoutMarker=true;return localStorage.getItem('dash.frame.rotation.v1');});
    photos=depthPhotos;
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(()=>document.querySelector('.frame-foreground.is-active'));
    await settle(1200);
    assert.equal(await page.locator('.frame-photo.is-active').getAttribute('src'),photoSet[1].url);
    assert.equal(await page.evaluate(()=>localStorage.getItem('dash.frame.rotation.v1')),savedRotation);
    assert.equal(await page.evaluate(()=>window.lateCutoutMarker),true,'Cutout arrival needs no reload');
    assert.ok((await page.locator('.frame-foreground.is-active').getAttribute('style')).includes('portrait'));
    await shot('depth-arrives-after-commit');
    prefs={[imageId]:{clock:'top-left',position_x:50,position_y:50}};
    photos=[depthPhotos[0]];activatedAt=Date.now();await reloadFrame();await settle(1500);
    const clockBox=await page.locator('#frameClock').boundingBox();
    async function whitePixels() {
      const png=await page.screenshot({clip:clockBox});
      return page.evaluate(async b64=>{
        const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();
        const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let white=0;for(let i=0;i<pixels.length;i+=4) if(pixels[i]>225&&pixels[i+1]>225&&pixels[i+2]>225) white++;
        return white;
      },png.toString('base64'));
    }
    const beforeDepth=await whitePixels();assert.ok(beforeDepth>1000);
    await apps();await page.locator('[data-app="photos"]').click();await settle();
    assert.equal(await page.locator('#frameDepthChoice').isChecked(),false,'Depth is opt-in');
    assert.equal(await page.locator('#frameDepthChoice').isDisabled(),false);
    await page.locator('#frameDepthChoice').check();await settle();
    assert.equal(await page.locator('#framePreviewForeground').evaluate(el=>el.classList.contains('is-active')),true);
    await shot('depth-editor');
    await page.locator('#frameSavePhoto').click();await settle();
    // Preview and final frame must predict the same overlap, even on phone/short screens.
    for(const size of [{width:1280,height:800},{width:390,height:844},{width:800,height:480}]) {
      await page.setViewportSize(size);await settle(800);
      const geometry=await page.evaluate(()=>{
        const surface=document.getElementById('dashboardView').getBoundingClientRect();
        const preview=document.getElementById('framePreviewImage').getBoundingClientRect();
        const actual=document.getElementById('frameClock').getBoundingClientRect();
        const mini=document.getElementById('framePreviewClock').getBoundingClientRect();
        const scale=preview.width/surface.width;
        return {scale,actual:{x:actual.x-surface.x,y:actual.y-surface.y,width:actual.width,height:actual.height},mini:{x:mini.x-preview.x,y:mini.y-preview.y,width:mini.width,height:mini.height}};
      });
      for(const key of ['x','y','width','height']) assert.ok(Math.abs(geometry.mini[key]/geometry.scale-geometry.actual[key])<3,`Preview ${size.width} ${key} matches dashboard: ${JSON.stringify(geometry)}`);
    }
    await page.setViewportSize({width:1280,height:800});await settle(800);
    await closeApp();await settle(1500);
    assert.equal(prefs[imageId].depth,true);
    assert.ok(await whitePixels()<beforeDepth*.15,'The opaque subject must occlude clock pixels');
    await shot('depth-clock-occlusion');
    assert.equal(await page.locator('#dashboardView > .frame-foreground.is-active').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
    const foreground=page.locator('#dashboardView > .frame-foreground.is-active');
    assert.equal(await foreground.locator('img').getAttribute('src'),depthPhotos[0].url,'Use original colors beneath alpha');
    assert.equal(await foreground.locator('img').evaluate(el=>el.style.objectPosition),await page.locator('.frame-photo.is-active').evaluate(el=>el.style.objectPosition));
    assert.ok(await page.locator('#frameWeather').evaluate(el=>Number(getComputedStyle(el.parentElement).zIndex))>await foreground.evaluate(el=>Number(getComputedStyle(el).zIndex)),'Widgets stay above foreground');
    await reloadFrame();await settle(1500);
    assert.equal(await page.locator('#dashboardView > .frame-foreground.is-active').count(),1,'Depth survives reload');
    await apps();await page.locator('[data-app="photos"]').click();await settle();
    await page.locator('#frameCropX').evaluate(el=>{el.value='30';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#frameClockChoice').selectOption('bottom-center');
    await page.locator('#frameSavePhoto').click();await settle();await closeApp();await settle(1500);
    assert.equal(prefs[imageId].depth,true,'Crop and clock edits preserve depth');
    await page.setViewportSize({width:1024,height:600});await settle(1500);
    assert.equal(await foreground.evaluate(el=>el.style.maskPosition),await page.locator('.frame-photo.is-active').evaluate(el=>el.style.objectPosition),'Resize keeps crop and alpha aligned');
    photos=depthPhotos;prefs[secondId]={clock:'top-right',depth:true};activatedAt=Date.now();
    await reloadFrame();await settle(1500);
    await page.locator('#dashboardView').click({position:{x:600,y:260}});await settle(300);
    const transitions=await page.evaluate(()=>['A','B'].map(layer=>({
      background:Number(getComputedStyle(document.getElementById('framePhoto'+layer)).opacity),
      foreground:Number(getComputedStyle(document.getElementById('frameForeground'+layer)).opacity)
    })));
    transitions.forEach(pair=>assert.ok(Math.abs(pair.background-pair.foreground)<.04,'Paired layers crossfade together'));
    await settle(1500);assert.match(await foreground.locator('img').getAttribute('src'),/portrait/);
    apiOffline=true;frameOffline=true;await settle(1000);
    assert.equal(await foreground.count(),1,'Loaded depth survives disconnection');
    apiOffline=false;frameOffline=false;
    // Missing, mismatched, and absent cutouts all retain a usable original photo.
    for(const foregroundData of [{...depthPhotos[0].foreground,url:'/foreground-missing.png'},depthPhotos[1].foreground,null]) {
      photos=[{...depthPhotos[0],foreground:foregroundData}];activatedAt=Date.now();
      prefs={[imageId]:{clock:'top-left',depth:true}};await reloadFrame();await settle(1500);
      assert.equal(await page.locator('.frame-photo.is-active').count(),1);
      assert.equal(await page.locator('#dashboardView > .frame-foreground.is-active').count(),0);
    }
    await apps();await page.locator('[data-app="photos"]').click();await settle();
    assert.equal(await page.locator('#frameDepthChoice').isDisabled(),true);
    await closeApp();
    await page.emulateMedia({reducedMotion:'reduce'});
    photos=[depthPhotos[0]];activatedAt=Date.now();await reloadFrame();await settle();
    assert.ok(await foreground.evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration))<=.001,'Reduced motion makes depth transitions immediate');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.setViewportSize({width:1280,height:800});

    if (process.env.FRAME_TEST_DEPTH_ONLY) {
      assert.equal(errors.length,0,errors.join('\n'));
      console.log(`Depth browser scenarios passed. Screenshots: ${output}`);
      return;
    }
    // A controlled browser clock exercises real scheduling without a 15-minute wait.
    await page.clock.install({time:new Date()});
    activatedAt=Date.now();prefs={};photos=photoSet;
    await reloadFrame();
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/landscape/);
    await page.clock.fastForward(900001);await settle(1700);
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/portrait/);
    await reloadFrame();
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/portrait/,'Reload must retain scheduled photo');

    await page.clock.fastForward(420000);await settle();
    const beforePhotoActions=actions.length;
    await page.locator('#dashboardView').click({position:{x:700,y:260}});await settle(1700);
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/busy/,'A photo tap advances immediately');
    assert.equal(await page.locator('#dashboardView').evaluate(el=>el.classList.contains('controls-visible')),true);
    await page.locator('#btnOpenApps').click();await settle();
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/busy/,'Apps control must not advance photos');
    await page.keyboard.press('Escape');
    await page.locator('#frameWeather').click();await settle();
    await closeApp();
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/busy/,'Weather activity must not advance photos');
    await page.locator('#btnOpenSettings').click();await settle();
    await page.locator('#btnCloseSettings').click();await settle();
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/busy/,'Settings control must not advance photos');
    await page.clock.fastForward(480000);await settle();
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/busy/,'A tap starts a fresh interval even across the old scheduled boundary');
    await reloadFrame();
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/busy/,'Reload must preserve a manual advance');
    await page.clock.fastForward(420000);await settle(1700);
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/landscape/,'Automatic rotation continues after manual selection');
    await page.locator('#dashboardView').evaluate(el=>{el.click();el.click();el.click();});
    await settle(1700);
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/landscape/,'Rapid taps that wrap around must cancel pending images');
    await page.locator('#dashboardView').focus();await page.keyboard.press('ArrowRight');await settle(1700);
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/portrait/,'Keyboard can advance the photo');
    await page.touchscreen.tap(700,260);await settle(1700);
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/busy/,'A touch tap advances exactly one photo');
    assert.equal(actions.length,beforePhotoActions,'Manual photo selection must stay web-only');
    // A new daily batch gets its own rotation, independent of yesterday's taps.
    activatedAt=await page.evaluate(()=>Date.now());
    await reloadFrame();
    assert.match(await page.locator('.frame-photo.is-active').getAttribute('src'),/landscape/);
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
