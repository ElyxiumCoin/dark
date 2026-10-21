/* ZONA Z: Telegram-verified shared ranking; legacy saves never silently replaced. */
(() => {
  'use strict';
  const API = String(window.ZONA_API_URL || '').trim().replace(/\/+$/, '');
  const tg = window.Telegram && window.Telegram.WebApp;
  const init = tg && tg.initData || '';
  const SAVE = 'zona_z_save_v10';
  const ALT = ['zona_z_save_v9','zona_z_save_v5'];
  const $ = name => document.getElementById(name);
  const gameInstance = () => typeof game !== 'undefined' ? game : window.game;
  const readSave = () => { try { return localStorage.getItem(SAVE) || ALT.map(k => localStorage.getItem(k)).find(Boolean) || null; } catch (_) { return null; } };
  const parse = s => { try { return JSON.parse(s); } catch (_) { return null; } };
  const style = document.createElement('style');
  style.textContent = '.zona-online{display:grid;gap:10px}.zona-online .zrow{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.zona-online .zentry{display:flex;gap:10px;align-items:center;border:1px solid #66512c;background:#171912;padding:10px;margin:7px 0}.zona-online .zname{flex:1;min-width:100px}.zona-online small{display:block;color:#9fa795}.zona-online .zrank{color:#d6bd75;min-width:42px;font-weight:bold}.zona-online button{padding:7px 10px;margin:3px;background:#272b22;color:#dedfce;border:1px solid #817047;border-radius:3px}.zona-online button.active{background:#455c3d}.zona-online .zwarning{color:#e9c17b}.zona-online .zsuccess{color:#9ccea6}.zona-online .zchoices{border:1px solid #b58e46;padding:10px}';
  document.head.appendChild(style);
  let account = null, rev = 0, active = false, conflicted = false, dirty = false, saving = false, timer = null, serial = 0, lastUploaded = '';
  let serverState = null, tab = null, statusNode = null, list = null, choices = null, category = 'score', currentSeq = 0;
  const keys = id => ({revision:'zona_cloud_rev_'+id, dirty:'zona_cloud_dirty_'+id,backup:'zona_cloud_legacy_backup_'+id});
  function say(message, warn) {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.className = warn ? 'zwarning' : 'zsuccess';
  }
  function backup(id) {
    const raw = readSave();
    if (!raw || !id) return;
    try {
      const k = keys(id).backup;
      if (!localStorage.getItem(k)) localStorage.setItem(k,raw);
    } catch(_) { say('Недостаточно места для резервной копии. Перенос остановлен.',true); throw Error('Не удалось сохранить резервную копию'); }
  }
  async function call(route, options = {}) {
    if (!init) throw Error('Откройте игру через Telegram Mini App');
    if (!/^https:\/\/[^/]+$/i.test(API)) throw Error('Онлайн-сервер ещё не настроен');
    const response = await fetch(API+route, {
      method:options.method||'GET', cache:'no-store',
      headers:{Authorization:'tma '+init, ...(options.body ? {'Content-Type':'application/json'} : {})},
      body:options.body
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = Error(data.error || 'Ошибка сервера '+response.status); error.status=response.status; throw error; }
    return data;
  }
  function copyCloud() {
    if (!account || !serverState) return;
    try {
      backup(account);
      localStorage.setItem('zona_cloud_owner',account);
      localStorage.setItem(SAVE,JSON.stringify(serverState));
      localStorage.setItem(keys(account).revision,String(rev));
      localStorage.setItem(keys(account).dirty,'0');
      location.reload();
    } catch(e) { say('Не удалось загрузить сохранение: '+e.message,true); }
  }
  function markDirty() {
    if (!active || !account) return;
    dirty=true;currentSeq++;
    try { localStorage.setItem(keys(account).dirty,'1'); } catch (_) {}
    schedule();
  }
  function schedule() {
    if (timer || !active || conflicted || !dirty) return;
    timer=setTimeout(() => { timer=null; upload(); },4500);
  }
  async function upload() {
    if (!active || conflicted || !dirty || saving || !account) return;
    const state = gameInstance()?.state;
    if (!state) return;
    let body;
    try { body=JSON.stringify({revision:rev,state}); } catch (_) { say('Сохранение не удалось подготовить',true); return; }
    const seq = currentSeq;
    const snapshot=JSON.stringify(state);
    saving=true;
    try {
      const data=await call('/api/save',{method:'POST',body});
      rev=data.revision;
      lastUploaded=snapshot;
      dirty = seq!==currentSeq;
      localStorage.setItem(keys(account).revision,String(rev));
      localStorage.setItem(keys(account).dirty,dirty?'1':'0');
      say('Telegram подтверждён · прогресс сохранён в облаке');
    } catch(e) {
      if(e.status===409) {
        active=false;conflicted=true;
        try { const remote=await call('/api/me'); rev=remote.revision;serverState=remote.gameState; } catch(_) {}
        showChoices('Облачный прогресс изменился на другом устройстве. Выберите нужное сохранение.');
      }
      say('Облако недоступно: '+e.message+'. Локальное сохранение остаётся.',true);
    } finally { saving=false; if(active && dirty) schedule(); }
  }
  function showChoices(message) {
    conflicted=true;active=false;
    if (!choices) return;
    choices.replaceChildren();
    choices.className='zchoices';
    const title=document.createElement('p');title.textContent=message;choices.appendChild(title);
    const cloud=document.createElement('button');cloud.textContent='Загрузить облачное';cloud.disabled=!serverState;cloud.addEventListener('click',copyCloud);
    const local=document.createElement('button');local.textContent='Оставить местное';
    local.addEventListener('click',async () => {
      try {
        backup(account);
        const latest=await call('/api/me');
        rev=latest.revision;
        serverState=latest.gameState;
        localStorage.setItem('zona_cloud_owner',account);
        conflicted=false;active=true;dirty=true;currentSeq++;
        choices.replaceChildren();
        await upload();
        if(conflicted) showChoices('Данные изменились ещё раз. Выберите нужную версию.');
      } catch(e) { conflicted=true;active=false;say('Ошибка: '+e.message,true); }
    });
    choices.append(cloud,local);
  }
  function confirmFirstImport() {
    // A legacy local save has no verified Telegram owner. Never assign it silently.
    conflicted=true; active=false;
    if(!choices) return;
    choices.replaceChildren();
    choices.className='zchoices';
    const prompt=document.createElement('p');
    prompt.textContent='Найден прежний прогресс на этом устройстве. Перенести его в ваш Telegram-аккаунт? Не подтверждайте, если сохранение принадлежит другому игроку.';
    const yes=document.createElement('button');
    yes.textContent='Да, перенести мой прогресс';
    yes.addEventListener('click',async () => {
      yes.disabled=true;
      try {
        backup(account);
        const latest=await call('/api/me');
        rev=latest.revision; serverState=latest.gameState;
        if(serverState) {
          showChoices('В облаке появился прогресс. Выберите нужное сохранение.');
          return;
        }
        localStorage.setItem('zona_cloud_owner',account);
        choices.replaceChildren();
        conflicted=false; active=true; dirty=true; currentSeq++;
        await upload();
        loadRank();
      } catch(e) {
        conflicted=true; active=false;
        say('Перенос остановлен: '+e.message+'. Местное сохранение не удалено.',true);
        yes.disabled=false;
      }
    });
    const later=document.createElement('button');
    later.textContent='Пока не переносить';
    later.addEventListener('click',() => {
      choices.replaceChildren();
      say('Местный прогресс не изменён. Для переноса заново откройте игру.',true);
    });
    choices.append(prompt,yes,later);
  }
  const sorts={score:'Общий',level:'Уровень',kills:'Убийства',gram:'GRAM'};
  function setupUI() {
    tab=$('tab-leaderboard');
    if(!tab) return false;
    tab.replaceChildren();
    const root=document.createElement('div');root.className='zona-online';
    const head=document.createElement('div');head.className='card';
    const title=document.createElement('h3');title.textContent='☢ РЕЙТИНГ РЕАЛЬНЫХ СТАЛКЕРОВ';head.appendChild(title);
    statusNode=document.createElement('p');statusNode.className='zwarning';head.appendChild(statusNode);
    choices=document.createElement('div');head.appendChild(choices);
    const filters=document.createElement('div');filters.className='zrow';
    for(const [k,label] of Object.entries(sorts)){
      const btn=document.createElement('button');btn.textContent=label;
      btn.addEventListener('click',()=>{category=k;[...filters.children].forEach(b=>b.classList.remove('active'));btn.classList.add('active');loadRank();});
      if(k===category)btn.classList.add('active');
      filters.appendChild(btn);
    }
    head.appendChild(filters);root.appendChild(head);
    list=document.createElement('div');root.appendChild(list);tab.appendChild(root);return true;
  }
  function playerRow(p) {
    const row=document.createElement('div');row.className='zentry';
    const rank=document.createElement('span');rank.className='zrank';rank.textContent='#'+p.rank;row.appendChild(rank);
    const who=document.createElement('div');who.className='zname';
    const name=document.createElement('strong');name.textContent=(p.isMe?'★ ':'')+p.name;
    const detail=document.createElement('small');detail.textContent='Уровень '+p.level+(p.username?' · @'+p.username:'');
    who.append(name,detail);row.appendChild(who);
    const stats=document.createElement('div');
    const number=document.createElement('strong');number.textContent=Number(p.score||0).toLocaleString('ru-RU')+' очков';
    const sub=document.createElement('small');sub.textContent=Number(p.kills||0).toLocaleString('ru-RU')+' убийств · '+Number(p.gram||0)+' GRAM';
    stats.append(number,sub);row.appendChild(stats);
    return row;
  }
  async function loadRank() {
    if(!list) return;
    const current=++serial;
    if(!API || !init) { list.textContent='Общий рейтинг появится после подключения сервера и открытия игры через Telegram.';return; }
    list.textContent='Загрузка рейтинга…';
    try {
      const data=await call('/api/leaderboard?sort='+encodeURIComponent(category));
      if(current!==serial)return;
      list.replaceChildren();
      const count=document.createElement('p');count.textContent='Игроков с сохранённым прогрессом: '+data.total;list.appendChild(count);
      if(!data.players.length) { const empty=document.createElement('p');empty.textContent='Пока нет участников рейтинга.';list.appendChild(empty); }
      for(const p of data.players) {
        if(p.rank>50){const you=document.createElement('p');you.textContent='Ваше место:';list.appendChild(you);}
        list.appendChild(playerRow(p));
      }
    } catch(e) { if(current===serial)list.textContent='Рейтинг недоступен: '+e.message; }
  }
  async function connect() {
    if(!init) { say('Откройте игру через Telegram Mini App. Локальный прогресс работает.',true);return; }
    if(!API) { say('Сервер не подключён. Игра и местные сохранения работают как раньше.',true);return; }
    try {
      say('Проверка Telegram и сохранений…');
      const remote=await call('/api/me');
      account=String(remote.telegramId);rev=remote.revision;serverState=remote.gameState;
      const previous=localStorage.getItem('zona_cloud_owner');
      if(previous && previous!==account) {
        showChoices('На этом устройстве уже есть сохранение другого Telegram-аккаунта. Нельзя привязать его автоматически. Для нового аккаунта используйте отдельное устройство или профиль браузера.');
        for(const b of choices.querySelectorAll('button'))b.disabled=true;
        say('Перенос остановлен: на устройстве другой аккаунт.',true);return;
      }
      backup(account);
      const k=keys(account);
      const known=Number(localStorage.getItem(k.revision)||0);
      const locallyChanged=localStorage.getItem(k.dirty)==='1';
      const local=readSave();
      if(!serverState && local && !previous) {
        confirmFirstImport();
        say('Подтвердите перенос прежнего сохранения во вкладке «Рейтинг».',true);
        loadRank();
        return;
      }
      if(serverState && known!==rev && local) {
        showChoices('Есть два сохранения: на устройстве и в облаке. Ничего не удалено.');
        say('Выберите нужный прогресс перед синхронизацией.',true);return;
      }
      if(serverState && !local) { copyCloud();return; }
      if(serverState && known===0 && local && JSON.stringify(parse(local))!==JSON.stringify(serverState)) {
        showChoices('Обнаружены местное и облачное сохранения. Выберите нужное.');
        say('Выберите сохранение во вкладке «Рейтинг».',true);return;
      }
      active=true;
      localStorage.setItem('zona_cloud_owner',account);
      const current=gameInstance()?.state;
      if(serverState && current && JSON.stringify(current)!==JSON.stringify(serverState)) {
        if(known===rev || locallyChanged)markDirty();
        else { showChoices('На устройстве и в облаке разный прогресс. Выберите нужный.');return; }
      } else if(!serverState && local) markDirty();
      say('Telegram подтверждён · облачный аккаунт подключён');
      loadRank();
    } catch(e) { say('Нет связи с сервером: '+e.message+'. Локальный прогресс сохранён.',true); }
  }
  // The main game is instantiated in a window DOMContentLoaded handler.
  // A document DOMContentLoaded handler runs earlier during event bubbling,
  // before `game = new Game()`; therefore register on window as well.
  window.addEventListener('DOMContentLoaded',() => {
    const g=gameInstance();
    if(!g || !setupUI()) return;
    // Remove the old simulated NPC leaderboard; use real Telegram users only.
    g.renderLeaderboard=function(){loadRank();};
    const save=g.saveState;
    g.saveState=function(...args){const result=save.apply(this,args);markDirty();return result;};
    document.addEventListener('visibilitychange',() => {
      if(!document.hidden) { if(active && dirty)schedule(); if(tab.classList.contains('active'))loadRank(); }
    });
    setInterval(() => {
      if(!active)return;
      if(JSON.stringify(g.state)!==lastUploaded && !dirty)markDirty();
      if(tab.classList.contains('active'))loadRank();
    },60000);
    connect();
    loadRank();
  });
})();
