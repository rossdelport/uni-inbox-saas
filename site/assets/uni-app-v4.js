/* ==== Uni-Inbox app engine: shared state, plan logic, modals, toasts ==== */
window.UNI = (function(){
  var PROVIDERS = {
    gmail:   {name:'Gmail',   color:'#EA4335', hint:'name@gmail.com'},
    outlook: {name:'Outlook', color:'#0078D4', hint:'name@outlook.com'},
    icloud:  {name:'iCloud',  color:'#3693F3', hint:'name@icloud.com'},
    other:   {name:'Other',   color:'#00B050', hint:'you@yourdomain.com'}
  };
  var DEFAULT_ACCOUNTS = [
    {id:'a1', prov:'gmail',   email:'ross@acmestudio.com'},
    {id:'a2', prov:'outlook', email:'ross@northwind.co'},
    {id:'a3', prov:'icloud',  email:'ross@icloud.com'},
    {id:'a4', prov:'other',   email:'ross@trynoisy.com'}
  ];
  var DEFAULT_PLAN = {tier:'monthly', included:3, extra:2};   // $9/mo, 5 accounts
  var DEFAULT_PROFILE = {name:'Ross Miller', email:'ross@acmestudio.com'};

  function load(k, def){ try{ var v = JSON.parse(localStorage.getItem(k)); return v || JSON.parse(JSON.stringify(def)); }catch(e){ return JSON.parse(JSON.stringify(def)); } }
  function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

  var api = {PROVIDERS: PROVIDERS};
  api.getAccounts = function(){ return load('uni-accounts', DEFAULT_ACCOUNTS); };
  api.saveAccounts = function(a){ save('uni-accounts', a); };
  api.getPlan = function(){ return load('uni-plan', DEFAULT_PLAN); };
  api.savePlan = function(p){ save('uni-plan', p); };
  api.getProfile = function(){ return load('uni-profile', DEFAULT_PROFILE); };
  api.saveProfile = function(p){ save('uni-profile', p); };
  api.getNotif = function(){ return load('uni-notif', {product:true, digest:true, security:true}); };
  api.saveNotif = function(n){ save('uni-notif', n); };
  api.resetAll = function(){ try{ ['uni-accounts','uni-plan','uni-profile','uni-notif'].forEach(function(k){ localStorage.removeItem(k); }); }catch(e){} };

  api.planLimit = function(p){ p = p || api.getPlan(); return p.tier === 'lifetime' ? 10 : p.included + p.extra; };
  api.planLabel = function(p){ p = p || api.getPlan(); return p.tier === 'lifetime' ? 'Lifetime' : 'Monthly'; };
  api.planPrice = function(p){ p = p || api.getPlan(); return p.tier === 'lifetime' ? '$50 one-time' : '$' + (5 + 2 * (p.extra || 0)) + '/month'; };

  /* ---------- toast (inline-styled: immune to stale CSS cache) ---------- */
  var toastEl = null, toastT = null;
  api.toast = function(msg){
    if (!toastEl){
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(16px);background:#111;color:#fff;font-size:14px;font-weight:600;padding:13px 24px;border-radius:999px;box-shadow:0 12px 30px rgba(0,0,0,.3);opacity:0;transition:opacity .22s ease,transform .22s ease;z-index:300;pointer-events:none;max-width:calc(100vw - 40px);text-align:center;font-family:Inter,-apple-system,sans-serif';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    requestAnimationFrame(function(){ toastEl.style.opacity = '1'; toastEl.style.transform = 'translateX(-50%)'; });
    clearTimeout(toastT);
    toastT = setTimeout(function(){ toastEl.style.opacity = '0'; toastEl.style.transform = 'translateX(-50%) translateY(16px)'; }, 2400);
  };

  /* ---------- modal ---------- */
  api.modal = function(opts){
    var bg = document.createElement('div');
    bg.className = 'uni-modal-bg';
    bg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(13,32,64,.42);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:100;opacity:0;transition:opacity .18s ease;font-family:Inter,-apple-system,sans-serif';
    bg.innerHTML = '<div class="uni-modal" role="dialog" aria-modal="true" style="position:relative;width:560px;max-width:calc(100vw - 32px);max-height:calc(100vh - 60px);overflow-y:auto;background:#fff;border-radius:24px;box-shadow:0 30px 80px rgba(13,32,64,.35);padding:30px 32px 32px;transform:translateY(14px) scale(.98);transition:transform .2s ease;box-sizing:border-box;color:rgba(0,0,0,.83)">' +
      '<button class="m-close" aria-label="Close" style="position:absolute;top:16px;right:16px;width:34px;height:34px;border-radius:50%;background:#f2f7fc;color:rgba(0,0,0,.55);font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer">&times;</button>' +
      (opts.title ? '<h3 style="font-size:22px;font-weight:800;letter-spacing:-.02em;padding-right:34px;margin:0">' + opts.title + '</h3>' : '') +
      (opts.sub ? '<p style="margin:8px 0 0;font-size:14px;color:rgba(0,0,0,.55);line-height:1.55">' + opts.sub + '</p>' : '') +
      '<div class="m-body"></div></div>';
    bg.querySelector('.m-body').appendChild(opts.body);
    var card = bg.querySelector('.uni-modal');
    function openState(){ bg.style.opacity = '1'; card.style.transform = 'none'; }
    function close(){ bg.style.opacity = '0'; card.style.transform = 'translateY(14px) scale(.98)'; setTimeout(function(){ bg.remove(); }, 200); document.removeEventListener('keydown', onKey); }
    function onKey(e){ if (e.key === 'Escape') close(); }
    bg.addEventListener('mousedown', function(e){ if (e.target === bg) close(); });
    bg.querySelector('.m-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    requestAnimationFrame(openState);
    return {el: bg, close: close};
  };
  function elFrom(html){ var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  /* ---------- pricing / upgrade modal ---------- */
  api.openPlans = function(){
    var p = api.getPlan();
    var body = elFrom(
      '<div class="m-plans">' +
        '<div class="m-plan" data-tier="monthly">' + (p.tier === 'monthly' ? '<span class="badge-cur">Current plan</span>' : '') +
          '<div class="pname">Monthly</div><div class="price">$5<small>/month</small></div>' +
          '<ul><li>3 email accounts included</li><li>+$2/month per extra account</li><li>Unified inbox, search and labels</li><li>Cancel anytime</li></ul>' +
          '<button class="btn-black" data-act="monthly" style="height:44px;font-size:14px">' + (p.tier === 'monthly' ? 'Current plan' : 'Switch to Monthly') + '</button>' +
        '</div>' +
        '<div class="m-plan best" data-tier="lifetime">' + (p.tier === 'lifetime' ? '<span class="badge-cur">Current plan</span>' : '<span class="badge-cur" style="background:#111">Best value</span>') +
          '<div class="pname">Lifetime</div><div class="price">$50<small> one-time</small></div>' +
          '<ul><li>Up to 10 email accounts included</li><li>Every future update, forever</li><li>Unified inbox, search and labels</li><li>30-day money-back guarantee</li></ul>' +
          '<button class="btn-black" data-act="lifetime" style="height:44px;font-size:14px">' + (p.tier === 'lifetime' ? 'Current plan' : 'Switch to Lifetime') + '</button>' +
        '</div>' +
      '</div>');
    var m = api.modal({title: 'Choose your plan', sub: 'You are currently on the <b>' + api.planLabel() + '</b> plan (' + api.planPrice() + ', up to ' + api.planLimit() + ' accounts). Switch anytime.', body: body});
    body.querySelectorAll('[data-act]').forEach(function(btn){
      var tier = btn.getAttribute('data-act');
      if (tier === p.tier){ btn.disabled = true; btn.style.opacity = '.45'; btn.style.cursor = 'default'; return; }
      btn.addEventListener('click', function(){
        var np = tier === 'lifetime' ? {tier:'lifetime', included:10, extra:0} : {tier:'monthly', included:3, extra:0};
        api.savePlan(np);
        m.close();
        api.toast('Plan switched to ' + api.planLabel(np) + ' (' + api.planPrice(np) + ')');
        document.dispatchEvent(new CustomEvent('uni:state'));
      });
    });
    return m;
  };

  /* ---------- add account modal (with over-limit upsell) ---------- */
  api.openAddAccount = function(onAdded){
    var accounts = api.getAccounts();
    var plan = api.getPlan();
    var limit = api.planLimit(plan);

    function connectFlow(){
      var sel = 'gmail';
      var body = elFrom(
        '<div>' +
        '<div class="m-provs">' +
          Object.keys(PROVIDERS).map(function(k){
            return '<button class="m-prov' + (k === sel ? ' sel' : '') + '" data-p="' + k + '"><i style="background:' + PROVIDERS[k].color + '"></i>' + PROVIDERS[k].name + '</button>';
          }).join('') +
        '</div>' +
        '<div class="field" style="margin-top:20px"><label>Email address</label>' +
          '<input id="uni-new-email" type="email" placeholder="' + PROVIDERS[sel].hint + '"></div>' +
        '<div style="margin-top:20px;display:flex;gap:10px">' +
          '<button class="btn-black" id="uni-connect" style="flex:1;height:48px;font-size:15px">Connect account</button>' +
        '</div>' +
        '<p style="margin-top:14px;font-size:12px;color:rgba(0,0,0,.38);text-align:center">Demo flow: no real inbox is connected. ' + (accounts.length + 1) + ' of ' + limit + ' accounts used after this.</p>' +
        '</div>');
      var m = api.modal({title: 'Connect an account', sub: 'Pick a provider and sign in. It joins your unified inbox instantly.', body: body});
      body.querySelectorAll('.m-prov').forEach(function(b){
        b.addEventListener('click', function(){
          body.querySelectorAll('.m-prov').forEach(function(x){ x.classList.remove('sel'); });
          b.classList.add('sel');
          sel = b.getAttribute('data-p');
          body.querySelector('#uni-new-email').placeholder = PROVIDERS[sel].hint;
        });
      });
      body.querySelector('#uni-connect').addEventListener('click', function(){
        var email = body.querySelector('#uni-new-email').value.trim();
        if (!email || email.indexOf('@') < 0){ body.querySelector('#uni-new-email').focus(); body.querySelector('#uni-new-email').style.borderColor = '#EA4335'; return; }
        var list = api.getAccounts();
        list.push({id: 'a' + Date.now(), prov: sel, email: email});
        api.saveAccounts(list);
        m.close();
        api.toast(PROVIDERS[sel].name + ' account connected: ' + email);
        document.dispatchEvent(new CustomEvent('uni:state'));
        if (onAdded) onAdded();
      });
      setTimeout(function(){ body.querySelector('#uni-new-email').focus(); }, 250);
    }

    function paywall(){
      var body = elFrom(
        '<div>' +
        '<div class="m-limit">' +
          '<div class="m-limit-num">' + accounts.length + ' of ' + limit + '</div>' +
          '<div class="m-limit-txt">accounts used on your <b>' + api.planLabel(plan) + '</b> plan (' + api.planPrice(plan) + ')</div>' +
        '</div>' +
        '<div class="m-upsell">' +
          '<button class="btn-black" id="uni-extra" style="height:48px;font-size:15px">Add one more account, +$2/month</button>' +
          '<button class="btn-ghost" id="uni-golife">Go Lifetime, $50 once, 10 accounts</button>' +
        '</div>' +
        '<p style="margin-top:14px;font-size:12px;color:rgba(0,0,0,.38);text-align:center">Extra accounts stay on your Monthly bill. Lifetime covers up to 10 with no monthly cost.</p>' +
        '</div>');
      var m = api.modal({title: 'Your plan is full', sub: 'Minimum tiers grow with you. Add a single account, or unlock ten with Lifetime.', body: body});
      body.querySelector('#uni-extra').addEventListener('click', function(){
        plan.extra = (plan.extra || 0) + 1;
        api.savePlan(plan);
        m.close();
        api.toast('Plan updated: ' + api.planPrice(plan) + ', up to ' + api.planLimit(plan) + ' accounts');
        document.dispatchEvent(new CustomEvent('uni:state'));
        api.openAddAccount(onAdded);
      });
      body.querySelector('#uni-golife').addEventListener('click', function(){
        api.savePlan({tier:'lifetime', included:10, extra:0});
        m.close();
        api.toast('Welcome to Lifetime, 10 accounts included');
        document.dispatchEvent(new CustomEvent('uni:state'));
        api.openAddAccount(onAdded);
      });
    }

    if (accounts.length >= limit) paywall(); else connectFlow();
  };

  /* ---------- avatar dropdown (inline-styled: immune to stale CSS cache) ---------- */
  api.attachAvatarMenu = function(btn){
    var prof = api.getProfile();
    var wrap = btn.parentElement;
    wrap.style.position = 'relative';
    var dd = document.createElement('div');
    dd.style.cssText = 'position:absolute;top:50px;right:0;width:252px;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:18px;box-shadow:0 18px 44px rgba(13,71,161,.18);padding:8px;z-index:60;opacity:0;transform:translateY(-6px) scale(.98);pointer-events:none;transition:opacity .15s ease,transform .15s ease;font-family:Inter,-apple-system,sans-serif;box-sizing:border-box';
    var itemCss = 'display:flex;align-items:center;gap:11px;width:100%;padding:10px 12px;border-radius:11px;font-size:14px;font-weight:600;color:rgba(0,0,0,.83);text-align:left;text-decoration:none;background:none;border:none;cursor:pointer;font-family:inherit;box-sizing:border-box';
    function item(href, svg, label, extra){
      var tag = href ? '<a href="' + href + '"' : '<button type="button"';
      var end2 = href ? '</a>' : '</button>';
      return tag + ' style="' + itemCss + (extra || '') + '"' + (href ? '' : ' data-act') + '>' + svg + label + end2;
    }
    var sv = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:none"';
    dd.innerHTML =
      '<div style="padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.08);margin-bottom:6px"><div style="font-size:14px;font-weight:700">' + prof.name + '</div><div style="font-size:12px;color:rgba(0,0,0,.38);margin-top:2px">' + prof.email + '</div></div>' +
      item('/settings/', '<svg ' + sv + '><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>', 'Settings') +
      item(null, '<svg ' + sv + '><path d="M12 2l2.4 4.8 5.6.8-4 4 1 5.6-5-2.7-5 2.7 1-5.6-4-4 5.6-.8z"/></svg>', 'Plans &amp; billing') +
      item('/contacts/', '<svg ' + sv + '><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>', 'Help &amp; support') +
      '<div style="height:1px;background:rgba(0,0,0,.08);margin:6px 4px"></div>' +
      item('/login/', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EA4335" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>', 'Log out', ';color:#EA4335');
    wrap.appendChild(dd);
    function setOpen(o){
      dd.style.opacity = o ? '1' : '0';
      dd.style.transform = o ? 'none' : 'translateY(-6px) scale(.98)';
      dd.style.pointerEvents = o ? 'auto' : 'none';
    }
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      setOpen(dd.style.opacity !== '1');
    });
    document.addEventListener('click', function(e){
      if (!dd.contains(e.target) && e.target !== btn && !btn.contains(e.target)) setOpen(false);
    });
    dd.querySelectorAll('a,button').forEach(function(it){
      it.addEventListener('mouseenter', function(){ it.style.background = '#f2f7fc'; });
      it.addEventListener('mouseleave', function(){ it.style.background = 'none'; });
    });
    dd.querySelector('[data-act]').addEventListener('click', function(){
      setOpen(false);
      api.openPlans();
    });
    return dd;
  };

  return api;
})();
