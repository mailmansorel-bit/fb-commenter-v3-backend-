
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

console.log('=== DEMARRAGE BACKEND V3 ===');
console.log('Node version:', process.version);
console.log('Dir:', __dirname);
console.log('Files:', fs.readdirSync(__dirname));

const app = express();
app.use(cors());
app.use(express.json());

// Dossiers - cree si manquant
const JOBS_FILE = path.join(__dirname, 'jobs.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

try {
  if (!fs.existsSync(JOBS_FILE)) {
    fs.writeFileSync(JOBS_FILE, '[]');
    console.log('jobs.json cree');
  }
} catch(e){
  console.error('Erreur creation jobs.json:', e.message);
}

try {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, {recursive:true});
    console.log('public cree');
  }
} catch(e){
  console.error('Erreur creation public:', e.message);
}

// Servir frontend si existe
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

let jobs = [];
try {
  const data = fs.readFileSync(JOBS_FILE, 'utf8');
  jobs = JSON.parse(data);
  console.log(`Jobs charges: ${jobs.length}`);
} catch(e){
  console.log('Jobs vide ou erreur, init []:', e.message);
  jobs = [];
}

let timers = {};

function getRandomDelaySec(){ return Math.floor(Math.random()*(145-60+1))+60; }
function getRandomReplyDelay(){ return (Math.floor(Math.random()*(20-10+1))+10)*1000; }

async function publishComment(postId, message, token){
  const url = `https://graph.facebook.com/v20.0/${postId}/comments?message=${encodeURIComponent(message)}&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url,{method:'POST'});
  const j = await r.json();
  if(j.error) throw new Error(j.error.message);
  return j.id;
}
async function publishReply(commentId, message, token){
  const url = `https://graph.facebook.com/v20.0/${commentId}/comments?message=${encodeURIComponent(message)}&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url,{method:'POST'});
  const j = await r.json();
  if(j.error) throw new Error(j.error.message);
  return j.id;
}

function saveJobs(){
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs,null,2));
  } catch(e){
    console.error('Erreur saveJobs:', e.message);
  }
}

async function publishBatch(job){
  console.log(`DEBUT batch ${job.id} - ${job.comments.length} coms`);
  const token = job.token;
  const postId = job.postId;
  for(let i=0;i<job.comments.length;i++){
    const c = job.comments[i];
    const delaySec = i===0?0:getRandomDelaySec();
    if(i>0){
      console.log(`Attente ${delaySec}s avant #${i+1}`);
      await new Promise(r=>setTimeout(r, delaySec*1000));
    }
    try{
      const commentId = await publishComment(postId, c.text, token);
      console.log(`Com #${i+1} OK ${commentId}`);
      if(c.reply && c.reply.trim()!==''){
        const rd = getRandomReplyDelay();
        await new Promise(r=>setTimeout(r, rd));
        const rid = await publishReply(commentId, c.reply, token);
        console.log(`Reponse #${i+1} OK ${rid}`);
      }
    }catch(e){
      console.error(`Echec #${i+1}: ${e.message}`);
    }
  }
  console.log(`Batch ${job.id} termine`);
  jobs = jobs.filter(j=>j.id!=job.id);
  saveJobs();
}

function scheduleJobs(){
  Object.values(timers).forEach(t=>clearTimeout(t));
  timers={};
  jobs.forEach(job=>{
    const at = new Date(job.scheduledAt);
    let ms = at - new Date();
    if(ms<=0){
      console.log(`Job ${job.id} EN RETARD -> 3s`);
      timers[job.id]=setTimeout(()=>publishBatch(job),3000);
    }else{
      console.log(`Job ${job.id} dans ${Math.floor(ms/1000)}s`);
      timers[job.id]=setTimeout(()=>publishBatch(job), ms);
    }
  });
}

// ROUTES
app.get('/', (req,res)=>{
  res.send(`<h1>Backend V3 OK - Fix 254</h1><p>Jobs: ${jobs.length}</p><p><a href="/jobs">/jobs</a> | <a href="/health">/health</a></p><p>Node: ${process.version}</p>`);
});

app.get('/health', (req,res)=>{res.json({status:'ok', jobs:jobs.length, node:process.version});});
app.get('/jobs', (req,res)=>{res.json(jobs);});

app.post('/jobs', (req,res)=>{
  try {
    const job = req.body;
    job.id = job.id || Date.now()+Math.random();
    if(job.postId && !job.postId.includes('_') && /^\d+$/.test(job.postId) && job.pageId){
      job.postId = job.pageId+'_'+job.postId;
    }
    jobs.push(job);
    saveJobs();
    scheduleJobs();
    console.log(`Nouveau job ${job.id}`);
    res.json({ok:true, id:job.id});
  } catch(e){
    console.error(e);
    res.status(500).json({error:e.message});
  }
});

app.post('/jobs/import', (req,res)=>{
  try {
    const data = req.body;
    let imported=0;
    if(data.queue && Array.isArray(data.queue)){
      data.queue.forEach(q=>{
        q.token = q.token || data.token;
        q.pageId = q.pageId || data.pageId;
        q.id = q.id || Date.now()+Math.random();
        jobs.push(q);
        imported++;
      });
    }else if(data.comments){
      const job = data;
      job.id = job.id || Date.now()+Math.random();
      jobs.push(job);
      imported=1;
    }
    saveJobs();
    scheduleJobs();
    res.json({ok:true, imported});
  } catch(e){
    res.status(500).json({error:e.message});
  }
});

app.post('/jobs/add-comment/:id', (req,res)=>{
  const job = jobs.find(j=>j.id==req.params.id);
  if(!job) return res.status(404).json({error:'job not found'});
  const newCom = req.body;
  newCom.id = newCom.id || Date.now()+Math.random();
  job.comments.push(newCom);
  saveJobs();
  res.json({ok:true, total:job.comments.length});
});

app.delete('/jobs/:id', (req,res)=>{
  jobs = jobs.filter(j=>j.id!=req.params.id);
  if(timers[req.params.id]) clearTimeout(timers[req.params.id]);
  saveJobs();
  res.json({ok:true});
});

app.delete('/jobs', (req,res)=>{
  jobs=[]; Object.values(timers).forEach(t=>clearTimeout(t)); timers={}; saveJobs();
  res.json({ok:true});
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', ()=>{
  console.log(`Backend V3 sur port ${PORT} - OK Fix 254`);
  scheduleJobs();
  
  // Cron simple sans node-cron au debut pour eviter crash
  try {
    const cron = require('node-cron');
    cron.schedule('* * * * *', ()=>{
      const now=new Date();
      jobs.forEach(job=>{
        const at=new Date(job.scheduledAt);
        if(at<=now && !timers[job.id]){
          console.log(`Cron retard ${job.id}`);
          publishBatch(job);
        }
      });
    });
    console.log('Cron active');
  } catch(e){
    console.error('Cron erreur:', e.message);
  }
});

process.on('uncaughtException', (e)=>{
  console.error('uncaughtException:', e);
});

process.on('unhandledRejection', (e)=>{
  console.error('unhandledRejection:', e);
});
