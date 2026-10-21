'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname,'../../online.js'),'utf8');

function harness({localState,cloudState=null,cloudRevision=0}={}) {
  class Node {
    constructor(tag){
      this.tag=tag;this.children=[];this.textContent='';this.className='';
      this.disabled=false;this.listeners={};
      this.classList={contains:()=>false,add:()=>{},remove:()=>{}};
    }
    appendChild(node){this.children.push(node);return node;}
    append(...nodes){for(const n of nodes)this.appendChild(n);}
    replaceChildren(...nodes){this.children=[...nodes];this.textContent='';}
    addEventListener(name,fn){this.listeners[name]=fn;}
    querySelectorAll(){return [];}
  }
  const tab = new Node('tab');
  const handlers = {};
  const windowHandlers = {};
  const document = {
    head:new Node('head'),
    createElement:tag=>new Node(tag),
    getElementById:id=>id==='tab-leaderboard'?tab:null,
    addEventListener:(name,fn)=>{handlers[name]=fn;}
  };
  const data = new Map();
  if(localState) data.set('zona_z_save_v10',JSON.stringify(localState));
  const writes=[];
  const localStorage = {
    getItem:key=>data.get(key)||null,
    setItem:(key,value)=>{data.set(key,String(value));writes.push([key,String(value)]);}
  };
  const posts=[];
  const fetch = async (url,options={})=>{
    const route = new URL(url).pathname;
    const result = route==='/api/me'
      ? {telegramId:'123',revision:cloudRevision,gameState:cloudState,updatedAt:null}
      : route==='/api/leaderboard'
        ? {sort:'score',total:0,players:[]}
        : route==='/api/save'
          ? (posts.push(JSON.parse(options.body)),{ok:true,revision:cloudRevision+1,updatedAt:null})
          : null;
    if(result===null)throw Error('Unexpected endpoint: '+route);
    return {ok:true,status:200,json:async()=>result};
  };
  const game = {state:localState||{name:'Сталкер',level:1,tracker:{kills:0,searches:0}},
    saveState(){},renderLeaderboard(){}};
  const context = {document,localStorage,fetch,game:undefined,console,
    window:{Telegram:{WebApp:{initData:'test-init-data'}},ZONA_API_URL:'https://api.example.test',
      addEventListener:(name,fn)=>{windowHandlers[name]=fn;}},
    location:{reload(){}},setTimeout:()=>1,setInterval:()=>1};
  vm.runInNewContext(code,context,{filename:'online.js'});
  // Emulate the real page: the Game instance is created by an earlier window
  // DOMContentLoaded listener, after document listeners but before online.js.
  assert.equal(handlers.DOMContentLoaded,undefined,'online startup must not run on document first');
  assert.equal(typeof windowHandlers.DOMContentLoaded,'function');
  context.game=game;
  windowHandlers.DOMContentLoaded();
  const findButton=text=>{
    const queue=[tab];
    while(queue.length){
      const node=queue.shift();
      if(node.tag==='button' && node.textContent===text)return node;
      queue.push(...node.children);
    }
    return null;
  };
  const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
  return {data,writes,posts,findButton,settle};
}

test('initial legacy save waits for explicit Telegram owner confirmation',async()=>{
  const legacy={name:'Старый сталкер',level:42,rubles:23456,tracker:{kills:48,searches:3}};
  const h=harness({localState:legacy});
  await h.settle();
  assert.equal(h.posts.length,0);
  assert.deepEqual(JSON.parse(h.data.get('zona_z_save_v10')),legacy);
  assert.deepEqual(JSON.parse(h.data.get('zona_cloud_legacy_backup_123')),legacy);
  const later=h.findButton('Пока не переносить');
  assert.ok(later,'there should be a keep-local button');
  later.listeners.click();
  await h.settle();
  assert.equal(h.posts.length,0);
  assert.equal(h.data.get('zona_cloud_owner'),undefined);
});

test('confirmed legacy import saves the same progress and retains backup',async()=>{
  const legacy={name:'Сталкер 12',level:17,rubles:550,tracker:{kills:19,searches:4}};
  const h=harness({localState:legacy});
  await h.settle();
  const confirm=h.findButton('Да, перенести мой прогресс');
  assert.ok(confirm,'there should be an explicit import button');
  await confirm.listeners.click();
  await h.settle();
  assert.equal(h.posts.length,1);
  assert.equal(h.posts[0].revision,0);
  assert.deepEqual(h.posts[0].state,legacy);
  assert.equal(h.data.get('zona_cloud_owner'),'123');
  assert.deepEqual(JSON.parse(h.data.get('zona_cloud_legacy_backup_123')),legacy);
});

test('conflicting cloud save is never silently copied over local progress',async()=>{
  const legacy={name:'Локальный',level:12};
  const remote={name:'Облачный',level:30};
  const h=harness({localState:legacy,cloudState:remote,cloudRevision:3});
  await h.settle();
  assert.equal(h.posts.length,0);
  assert.deepEqual(JSON.parse(h.data.get('zona_z_save_v10')),legacy);
  const cloud=h.findButton('Загрузить облачное');
  assert.ok(cloud,'conflicting saves should require a manual choice');
  assert.equal(h.data.get('zona_cloud_owner'),undefined);
});

test('existing test cloud account does not silently override a higher local GitHub save',async()=>{
  const githubSave={name:'Ветеран основной игры',level:79,rubles:999999,tracker:{kills:876,searches:120},inventory:['artifact-x']};
  const testCloud={name:'Новый тестовый персонаж',level:1,rubles:0};
  const h=harness({localState:githubSave,cloudState:testCloud,cloudRevision:4});
  await h.settle();
  assert.equal(h.posts.length,0,'never upload without explicit consent');
  assert.deepEqual(JSON.parse(h.data.get('zona_z_save_v10')),githubSave,'old progress stays intact');
  assert.deepEqual(JSON.parse(h.data.get('zona_cloud_legacy_backup_123')),githubSave,'snapshot exists before any choice');
  assert.equal(h.data.get('zona_cloud_owner'),undefined,'ownership stays unset before choice');
  assert.ok(h.findButton('Загрузить облачное'),'explicit cloud choice appears');
  assert.ok(h.findButton('Перенести местное в облако'),'clearly labeled local upload appears');
  const postpone=h.findButton('Пока ничего не менять');
  assert.ok(postpone,'player can keep both saves unchanged');
  postpone.listeners.click();
  await h.settle();
  assert.equal(h.posts.length,0,'postponing never sends a save');
  assert.deepEqual(JSON.parse(h.data.get('zona_z_save_v10')),githubSave);
});

test('main-game online candidate has HTTPS API configured without credentials',()=>{
  const config=fs.readFileSync(path.join(__dirname,'../../online-config.js'),'utf8');
  assert.match(config,/window\.ZONA_API_URL\s*=\s*'https:\/\/zona-z-api-main\.onrender\.com'/);
  assert.doesNotMatch(config,/(?:postgres(?:ql)?:\/\/|BOT_TOKEN\s*=|DATABASE_URL\s*=)/);
});

test('candidate page loads Telegram verification before the cloud adapter',()=>{
  const page=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
  const sdk=page.lastIndexOf('https://telegram.org/js/telegram-web-app.js');
  const cfg=page.lastIndexOf('src="online-config.js"');
  const adapter=page.lastIndexOf('src="online.js"');
  assert.ok(sdk>=0 && cfg>sdk && adapter>cfg,'SDK, API configuration and adapter scripts must load in order');
  assert.match(page,/id="tab-leaderboard"/);
});

test('leaderboard UI initializes after game construction, removing old placeholder',async()=>{
  const h=harness();
  await h.settle();
  assert.equal(h.findButton('Общий')!==null,true,'real leaderboard categories must mount');
});
