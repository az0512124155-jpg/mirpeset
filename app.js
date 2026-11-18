const $ = id => document.getElementById(id);
const dialog = $('dialog');
const timeZone = 'Asia/Jerusalem';
const todayFormat = new Intl.DateTimeFormat('sv-SE',{timeZone});
const dateFormat = new Intl.DateTimeFormat('he-IL',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'});
const monthFormat = new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric',timeZone:'UTC'});
const clock = new Intl.DateTimeFormat('he-IL',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone});
const shortDays = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
const utc = day => new Date(`${day}T12:00:00Z`);
const shift = (day,n) => new Date(+utc(day)+n*86400000).toISOString().slice(0,10);
const week = day => shift(day,-utc(day).getUTCDay());
let state = {today:todayFormat.format(new Date()),now:Date.now(),user:null,bookings:[]};
let selected = state.today;
let first = week(selected);
let config = {};
let installPrompt;
let scanner;
let scanToken;
let rendered;
let subscription;
const apiRoot=window.MIRPESET_API || '/api';
const sessionKey=`mirpeset-session:${location.pathname}`;

async function api(path, body) {
  const headers=new Headers();
  if (body!==undefined) headers.set('Content-Type','application/json');
  if (window.MIRPESET_API) {
    const token=localStorage.getItem(sessionKey);
    if (token) headers.set('X-Terrace-Session',token);
  }
  const response = await fetch(`${apiRoot}/${path}`,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)});
  const session=response.headers.get('X-Terrace-Session');
  if (session==='clear') localStorage.removeItem(sessionKey);
  else if (session) localStorage.setItem(sessionKey,session);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'אירעה תקלה. נסו שוב.');
  return result;
}
function notice(message,error=false) {
  $('message').hidden = !message;
  $('message').classList.toggle('error',error);
  $('message').textContent = message;
}
function modal(title,html) {
  $('dialog-title').textContent=title;
  $('dialog-body').innerHTML=html;
  $('dialog-error').hidden=true;
  if (!dialog.open) dialog.showModal();
}
dialog.setAttribute('aria-labelledby','dialog-title');
dialog.addEventListener('close',() => {scanner?.abort(); scanner=undefined;});
async function task(button,work) {
  if (button.disabled) return;
  button.disabled=true;
  try {await work();}
  catch (error) {
    if (dialog.open) {
      $('dialog-error').textContent=error.name==='NotAllowedError' ? 'הפעולה בוטלה או שהמכשיר לא אישר אותה. אפשר לנסות שוב.' : error.message;
      $('dialog-error').hidden=false;
    } else notice(error.message,true);
  } finally {button.disabled=false;}
}
function element(type,text,className) {
  const el=document.createElement(type);
  el.textContent=text;
  if (className) el.className=className;
  if (type==='button') el.type='button';
  return el;
}
function render() {
  const signature=JSON.stringify([state.user,state.today,state.bookings,state.bookings.filter(b=>b.end<=state.now).map(b=>b.id),first,selected,config.demo,Boolean(subscription)]);
  if (rendered===signature) return;
  rendered=signature;
  $('account').textContent=state.user?.name || (state.user?'בחירת שם':'התחברות');
  $('notification').hidden=!(state.user?.name && config.pushKey);
  $('notification').textContent=subscription ? 'התראות פעילות' : 'הפעלת התראות';
  const active=state.bookings.find(b => b.status==='active');
  const mine=active && active.owner===state.user?.id;
  const next=mine && state.bookings.find(b => b.status==='booked' && b.owner!==active.owner && b.start>=active.end && b.end>state.now);
  $('visit-title').textContent=mine?'המרפסת בשימוש שלכם':'כניסה ויציאה';
  $('visit-text').textContent=mine ? (next ? `התור הבא מתחיל ${dateFormat.format(utc(todayFormat.format(next.start)))} ב־${clock.format(next.start)}.` : 'אפשר להישאר עד השריון הבא של מישהו אחר.') : 'סורקים פעם אחת כדי להתחיל את השימוש, ופעם נוספת אחרי הניקיון והפינוי.';
  $('visit-task').hidden=!mine;
  $('scan').textContent=mine?'סריקת יציאה':'סריקת תג NFC';
  $('dock-scan').textContent=mine?'סריקת יציאה':'סריקת תג';
  const last=shift(first,6);
  const firstMonth=monthFormat.format(utc(first)), lastMonth=monthFormat.format(utc(last));
  $('month').textContent=firstMonth===lastMonth ? firstMonth : `${firstMonth} – ${lastMonth}`;
  $('selected-date').textContent=dateFormat.format(utc(selected));
  const days=$('days');
  const focusedDay=days.contains(document.activeElement) ? document.activeElement.dataset.day : null;
  days.replaceChildren();
  const visibleOn=day => state.bookings.filter(b => b.day===day || (b.day<day && todayFormat.format(b.end)>=day && clock.format(b.end)!=='00:00'));
  for(let i=0;i<7;i++) {
    const day=shift(first,i), button=element('button','');
    button.dataset.day=day;
    button.setAttribute('aria-label',dateFormat.format(utc(day))+(day===state.today?' (היום)':'')+(visibleOn(day).length?', יש שריונים':''));
    button.setAttribute('aria-pressed',String(day===selected));
    if (day===state.today) button.setAttribute('aria-current','date');
    button.append(element('small',shortDays[i]),element('strong',String(utc(day).getUTCDate())),element('i','',visibleOn(day).length?'':'empty-dot'));
    button.onclick=() => choose(day);
    days.append(button);
    if (day===focusedDay) button.focus();
  }
  const list=$('bookings');
  list.replaceChildren();
  const visible=visibleOn(selected);
  if (!visible.length) {
    const empty=element('div',state.user?.name ? 'אין שריונים ליום הזה.' : 'התחברו כדי לראות את השריונים של הקבוצה.','empty');
    const action=element('button',state.user?.name ? 'שריון לשעה פנויה' : 'התחברות במפתח גישה','quiet');
    action.onclick=book;
    if (selected>=state.today || !state.user) empty.append(action);
    list.append(empty);
  }
  for (const booking of visible) {
    const item=element('div','','booking');
    const status={active:' · בשימוש',done:' · הסתיים',booked:booking.end<=state.now?' · חלף':''}[booking.status];
    const time=element('bdi',`${clock.format(booking.start)} – ${clock.format(booking.end)}`);
    time.dir='ltr';
    item.append(time,element('span',booking.name+status+(booking.day!==todayFormat.format(booking.end)?' · עד למחרת':'')));
    if (booking.owner===state.user.id && booking.status==='booked') {
      const button=element('button','ביטול','quiet');
      button.onclick=() => {
        modal('ביטול שריון','<p>לבטל את השריון ולפנות את השעות לקבוצה?</p><button type="button" class="outline" id="confirm-cancel">כן, לבטל</button>');
        $('confirm-cancel').onclick=event => task(event.currentTarget,async () => {await api('cancel',{id:booking.id});dialog.close();await refresh();notice('השריון בוטל.');});
      };
      item.append(button);
    }
    list.append(item);
  }
}
async function refresh() {state=await api('state');render();}
function choose(day) {selected=day;first=week(day);render();}
$('previous').onclick=()=>choose(shift(selected,-7));
$('next').onclick=()=>choose(shift(selected,7));
$('today').onclick=()=>choose(state.today);

function signIn(after) {
  if (state.user && !state.user.name) return chooseName(after);
  modal(config.demo?'כניסה להדגמה':'התחברות למרפסת',config.demo ? '<p>בהדגמה האימות מדומה והנתונים זמניים.</p><button type="button" id="demo-enter" class="primary">המשך לבחירת שם</button>' : '<p>חדשים כאן? מתחילים באימות במכשיר. אחריו תבחרו שם שיופיע בלוח.</p><div class="dialog-actions"><button type="button" id="join" class="primary">הצטרפות ראשונה</button><button type="button" id="passkey" class="outline">התחברות במפתח גישה</button></div>');
  if (config.demo) {
    $('demo-enter').onclick=event=>task(event.currentTarget,async()=>{await api('demo',{});await signedIn(after);});
    return;
  }
  $('passkey').onclick=event=>task(event.currentTarget,()=>passkey(false,after));
  $('join').onclick=event=>task(event.currentTarget,()=>passkey(true,after));
}
function chooseName(after) {
  modal('איך לקרוא לכם?','<p>האימות הושלם. זה השם שחברי הקבוצה יראו בלוח.</p><form id="profile-form"><label class="field">שם שיופיע בלוח<input name="name" maxlength="36" autocomplete="nickname" required></label><button class="primary">שמירת שם והצטרפות</button></form>');
  $('profile-form').onsubmit=event=>{
    event.preventDefault();
    const data=Object.fromEntries(new FormData(event.currentTarget));
    void task(event.submitter,async()=>{await api('profile',data);await signedIn(after);});
  };
}
async function signedIn(after) {await refresh();if (!state.user?.name) return chooseName(after);dialog.close();if (after) after();else notice('התחברתם למרפסת.');}
async function passkey(register,after) {
  const library=window.SimpleWebAuthnBrowser;
  if (!library?.browserSupportsWebAuthn()) throw new Error('מפתחות גישה דורשים דפדפן תומך וכתובת מאובטחת.');
  const optionsJSON=await api('passkey/options',{register});
  const answer=register ? await library.startRegistration({optionsJSON}) : await library.startAuthentication({optionsJSON});
  await api('passkey/verify',answer);
  await signedIn(after);
}
$('account').onclick=()=>{
  if (!state.user?.name) return signIn();
  modal('החשבון שלי','<p id="display-name"></p><button id="logout" type="button" class="outline">התנתקות</button>');
  $('display-name').textContent=state.user.name;
  $('logout').onclick=event=>task(event.currentTarget,async()=>{if(subscription) await disablePush();await api('logout',{});dialog.close();await refresh();notice('התנתקתם.');});
};
function book() {
  if (!state.user?.name) return signIn(book);
  modal('שריון המרפסת','<form id="booking-form"><label class="field">תאריך התחלה<input name="day" id="booking-day" type="date" required></label><div class="time-fields"><label class="field">משעה<input name="start" type="time" dir="ltr" required></label><label class="field">עד שעה<input name="end" type="time" dir="ltr" required></label></div><p>שעת סיום מוקדמת משעת ההתחלה שייכת ליום הבא.</p><button class="primary">אישור שריון</button></form>');
  $('booking-day').min=state.today;
  $('booking-day').value=selected>=state.today?selected:state.today;
  $('booking-form').onsubmit=event=>{
    event.preventDefault();
    const data=Object.fromEntries(new FormData(event.currentTarget));
    void task(event.submitter,async()=>{await api('book',data);choose(data.day);dialog.close();await refresh();notice('השריון נשמר.');});
  };
}
$('hero-book').onclick=book;
$('dock-book').onclick=book;
$('dock-calendar').onclick=()=>{$('calendar-title').scrollIntoView({block:'start'});$('calendar-title').focus({preventScroll:true});};
$('calendar-title').tabIndex=-1;

function tagAction() {
  if (!state.user?.name) return signIn(tagAction);
  const mine=state.bookings.some(b=>b.status==='active'&&b.owner===state.user.id);
  modal(mine?'אישור יציאה':'אישור כניסה',mine?'<p>אשרו רק אחרי שניקיתם ופיניתם את המרפסת. השריונים הנוספים שלכם להיום יבוטלו.</p><button id="tag-confirm" class="primary" type="button">המרפסת נקייה ופנויה</button>':'<p>אשרו את הכניסה כדי להתחיל את השריון ולקבל את משימת הסיום שלכם.</p><button id="tag-confirm" class="primary" type="button">התחלת השימוש</button>');
  $('tag-confirm').onclick=event=>task(event.currentTarget,async()=>{await api('scan',{token:scanToken,action:mine?'out':'in'});scanToken=undefined;dialog.close();await refresh();notice(mine?'היציאה נרשמה. תודה שניקיתם!':'הכניסה נרשמה. תהנו במרפסת!');if(!mine) $('visit-title').scrollIntoView({block:'center'});});
}
function readTag(value) {
  try {
    const url=new URL(value);
    if (url.origin===location.origin && url.pathname===new URL('./',location.href).pathname && url.hash.startsWith('#nfc=')) return url.hash.slice(5);
  } catch { /* Ignore non-URL tag records. */ }
}
function openTagLink() {
  const token=readTag(location.href);
  if (!token) return;
  history.replaceState(null,'',location.pathname);
  scanToken=token;
  tagAction();
}
function scan() {
  if (!state.user?.name) return signIn(scan);
  if (config.demo) {scanToken='demo';return tagAction();}
  if (!('NDEFReader' in window)) return modal('סריקת תג המרפסת','<p>הצמידו את הטלפון הפתוח לתג שבמרפסת ופתחו את הקישור שמופיע בטלפון. באייפון הסריקה מתחילה דרך הטלפון עצמו. אפשר גם ב־Chrome באנדרואיד תומך.</p>');
  modal('סריקת תג המרפסת','<p>הפעילו NFC והצמידו את הטלפון לתג שבמרפסת.</p><button id="start-scan" class="primary" type="button">התחלת סריקה</button><p id="scan-status" role="status"></p>');
  $('start-scan').onclick=event=>task(event.currentTarget,async()=>{
    scanner?.abort();scanner=new AbortController();
    const device=new NDEFReader();
    device.onreading=({message})=>{
      const record=message.records.find(r=>r.recordType==='url');
      const token=record?.data && readTag(new TextDecoder().decode(record.data));
      if (!token) {$('scan-status').textContent='התג לא זוהה. נסו את תג המרפסת.';return;}
      scanner?.abort();scanToken=token;tagAction();
    };
    device.onreadingerror=()=>{$('scan-status').textContent='לא הצלחנו לקרוא את התג. נסו שוב.';};
    await device.scan({signal:scanner.signal});
    $('scan-status').textContent='ממתינים לתג…';
  });
}
$('scan').onclick=scan;
$('dock-scan').onclick=scan;

window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
$('install').onclick=event=>task(event.currentTarget,async()=>{
  if (installPrompt) {await installPrompt.prompt();installPrompt=undefined;return;}
  modal('התקנת המרפסת','<p>באנדרואיד פתחו את תפריט Chrome ובחרו ״התקנת אפליקציה״ או ״הוספה למסך הבית״. באייפון פתחו ב־Safari, לחצו על שיתוף ובחרו ״הוספה למסך הבית״.</p>');
});
const registration='serviceWorker' in navigator ? navigator.serviceWorker.register('./sw.js').catch(()=>null) : Promise.resolve(null);
async function disablePush() {
  await api('push/off',{endpoint:subscription.endpoint});
  await subscription.unsubscribe();
  subscription=null;render();
}
$('notification').onclick=event=>task(event.currentTarget,async()=>{
  if (subscription) {modal('התראות למרפסת','<p>התראות פינוי פעילות במכשיר הזה.</p><button id="mute" class="outline" type="button">כיבוי התראות</button>');$('mute').onclick=e=>task(e.currentTarget,async()=>{await disablePush();dialog.close();notice('ההתראות כובו.');});return;}
  if (!('Notification' in window) || !('PushManager' in window)) throw new Error('התראות דורשות דפדפן תומך. באייפון פתחו את האתר אחרי הוספה למסך הבית.');
  if (await Notification.requestPermission()!=='granted') throw new Error('התראות חסומות. אפשר לאפשר אותן בהגדרות האתר או המכשיר.');
  const reg=await registration;
  if (!reg) throw new Error('לא ניתן להפעיל התראות בכתובת הזאת.');
  const key=Uint8Array.from(atob(config.pushKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  try {await api('push',sub.toJSON());} catch(error) {await sub.unsubscribe();throw error;}
  subscription=sub;render();notice('ההתראות פעילות במכשיר הזה.');
});
$('privacy').onclick=()=>modal('פרטיות','<p>כל מי שנרשם לאתר יכול לראות את השמות לתצוגה ואת השריונים. השרת שומר מפתח ציבורי להתחברות ואת פרטי המינוי להתראות אם בחרתם להפעיל אותן. טביעת האצבע או נתוני הפנים נשארים במכשיר. להסרת החשבון והשריונים פנו למי שמנהל את האתר.</p>');

async function boot() {
  config=await api('config');
  await refresh();
  choose(state.today);
  if (config.demo) notice('מצב הדגמה · הנתונים זמניים והסריקה מדומה.');
  if (location.hash.startsWith('#join=')) {
    history.replaceState(null,'',location.pathname);
    if (!state.user?.name) signIn();
  } else if (state.user && !state.user.name && !location.hash.startsWith('#nfc=')) chooseName();
  openTagLink();
  const reg=await registration;
  subscription=await reg?.pushManager?.getSubscription();
  render();
}
void boot().catch(error=>notice(error.message,true));
window.addEventListener('hashchange',()=>void refresh().then(openTagLink).catch(error=>notice(error.message,true)));
setInterval(()=>{if(!document.hidden && state.user?.name) void refresh().catch(()=>{});},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden) void refresh().catch(()=>{});});
