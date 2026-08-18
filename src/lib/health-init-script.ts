/**
 * Client-side technical-failure reporting, as a blocking inline script,
 * not a React component -- see src/db/queries/app-health.ts for the
 * table this reports into and why RECOVERABLE_HYDRATION_ERROR is kept
 * distinct from everything else.
 *
 * Why not a component: a React hydration mismatch is detected DURING
 * React's commit phase, before any passive effect (including a
 * useEffect in a component mounted from the root layout) has run. A
 * first implementation as a `<HealthReporter />` component missed real
 * hydration errors for exactly this reason -- caught 2026-08-18 by a
 * real end-to-end check (a Playwright sweep detected one, the table
 * stayed empty) rather than assumed away. Running as a synchronous
 * inline script in `<head>`, ahead of any styled markup or app bundle
 * (same placement as THEME_INIT_SCRIPT), means the console.error
 * override and the error/unhandledrejection listeners are already
 * active before hydration -- or any other client code -- ever runs.
 *
 * Dependency-free and duplicated rather than shared with
 * src/lib/hydration-error.ts on purpose: this has to be a standalone
 * string of plain JS (dangerouslySetInnerHTML, no bundler, no imports),
 * so it cannot import a TypeScript module. The classification regex is
 * three lines; keep the two in sync by hand if either changes.
 *
 * Swallows its own errors throughout: a reporter that throws must never
 * be the reason a page breaks worse than whatever it was trying to
 * report.
 */
export const HEALTH_INIT_SCRIPT = `(function(){
try{
var ENDPOINT='/api/health-event';
var navigationId=(function(){
  if(window.crypto&&typeof window.crypto.randomUUID==='function'){
    try{return window.crypto.randomUUID();}catch(e){}
  }
  var s='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return s.replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);});
})();
var startedAt=(window.performance&&performance.now)?performance.now():Date.now();
var reported={};
function isHydrationError(msg){
  var m=String(msg).toLowerCase();
  return m.indexOf('hydration')!==-1||m.indexOf('did not match')!==-1
    ||/minified react error #(418|419|420|421|422|423|424|425)\\b/.test(m);
}
function extractCode(msg){var m=/react error #(\\d+)/i.exec(msg);return m?m[1]:null;}
function clientRef(){var el=document.querySelector('input[name="clientRef"]');return (el&&el.value)||null;}
function truncate(s,n){return s.length>n?s.slice(0,n):s;}
function send(eventType,extra){
  if(reported[eventType])return;
  reported[eventType]=true;
  var body={eventType:eventType,route:window.location.pathname,navigationId:navigationId,
    timeSinceNavigationMs:Math.round(((window.performance&&performance.now)?performance.now():Date.now())-startedAt),
    relatedSearchClientRef:clientRef()};
  for(var k in extra){body[k]=extra[k];}
  try{
    var payload=JSON.stringify(body);
    if(navigator.sendBeacon){navigator.sendBeacon(ENDPOINT,new Blob([payload],{type:'application/json'}));}
    else{fetch(ENDPOINT,{method:'POST',body:payload,keepalive:true,headers:{'Content-Type':'application/json'}});}
  }catch(e){}
}
var originalConsoleError=console.error;
console.error=function(){
  try{
    var args=Array.prototype.slice.call(arguments);
    var message=args.map(function(a){return (a&&a.message)?a.message:String(a);}).join(' ');
    if(isHydrationError(message)){
      send('RECOVERABLE_HYDRATION_ERROR',{reactErrorCode:extractCode(message),recovered:true,detail:truncate(message,500)});
    }
  }catch(e){}
  return originalConsoleError.apply(console,arguments);
};
window.addEventListener('error',function(event){
  var message=(event.error&&event.error.message)?event.error.message:String(event.message||'unknown error');
  if(isHydrationError(message)){
    send('RECOVERABLE_HYDRATION_ERROR',{reactErrorCode:extractCode(message),recovered:true,detail:truncate(message,500)});
  }else{
    send('UNHANDLED_CLIENT_ERROR',{detail:truncate(message,500)});
  }
});
window.addEventListener('unhandledrejection',function(event){
  var reason=event.reason;
  var message=(reason&&reason.message)?reason.message:String(reason);
  send('UNHANDLED_CLIENT_ERROR',{detail:truncate('unhandled rejection: '+message,500)});
});
}catch(e){}
})();`;
