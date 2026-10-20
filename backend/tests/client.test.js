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
  const context = {document,localStorage,fetch,game,console,
    window:{Telegram:{WebApp:{initData:'test-init-data'}},ZONA_API_URL:'https://api.example.test'},
    location:{reload(){}},setTimeout:()=>1,setInterval:()=>1};
  vm.runInNewContext(code,context,{filename:'online.js'});
  handlers.DOMContentLoaded();
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
