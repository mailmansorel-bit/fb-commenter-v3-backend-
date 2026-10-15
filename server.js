
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

console.log('=== BACKEND V4 FINAL - REPONSE 0s + CORS FIX ===');

const app = express();

// CORS ULTRA PERMISSIF pour fix failed to fetch
app.use(cors({
  origin: '*',
  methods: ['GET','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json());

// Handle preflight
app.options('*', cors());

const JOBS_FILE = path.join(__dirname, 'jobs.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

try { if (!fs.existsSync(JOBS_FILE)) fs.writeFileSync(JOBS_FILE, '[]'); } catch(e){}
try { if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, {recursive:true}); } catch(e){}

if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));

let jobs = [];
try { jobs = JSON.parse(fs.readFileSync(JOBS_FILE,'utf8')); console.log(`Jobs charges: ${jobs.length}`);} catch(e){ jobs=[]; }

let timers = {};

function getRandomDelaySec(){ return Math.floor(Math.random()*(145-60+1))+60; }
function getRandomReplyDelay(){ return 0; } // 0s immediat comme demande

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

function saveJobs(){ try{ fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs,null,2)); }catch(e){ console.error(e.message); } }

async function publishBatch(job){
  console.log(`DEBUT batch ${job.id} - ${job.comments.length} coms - reponse 0s`);
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
      console.log(`✅ Com #${i+1} OK ${commentId}`);
      if(c.reply && c.reply.trim()!==''){
        const rd = getRandomReplyDelay();
        if(rd>0) await new Promise(r=>setTimeout(r, rd));
        else console.log(`↳ Reponse #${i+1} immediate 0s`);
        try{
          const rid = await publishReply(commentId, c.reply, token);
          console.log(`✅ Reponse #${i+1} OK ${rid} (0s)`);
        }catch(re){
          console.log(`❌ Echec reponse #${i+1}: ${re.message} - retry 2s`);
          await new Promise(r=>setTimeout(r,2000));
          try{
            const rid2 = await publishReply(commentId, c.reply, token);
            console.log(`✅ Reponse #${i+1} OK 2e essai ${rid2}`);
          }catch(re2){ console.log(`❌ Echec definitif #${i+1}: ${re2.message}`); }
        }
      }
    }catch(e){ console.error(`❌ Echec com #${i+1}: ${e.message}`); }
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
  res.send(`
  <h1>✅ Backend V4 FINAL - REPONSE 0s + CORS OK</h1>
  <p>Jobs en attente: ${jobs.length}</p>
  <p><a href="/health">/health</a> - Test si backend reveille</p>
  <p><a href="/jobs">/jobs</a> - Voir file</p>
  <p>Node: ${process.version}</p>
  <p style="color:green">CORS: * (tous domaines autorises) - fix failed to fetch</p>
  <p>Reponse delai: 0s immediat</p>
  `);
});
app.get('/health', (req,res)=>{ res.json({status:'ok', jobs:jobs.length, replyDelay:'0s', cors:'*'}); });
app.get('/jobs', (req,res)=>{ res.json(jobs); });

app.post('/jobs', (req,res)=>{
  try{
    const job = req.body;
    job.id = job.id || Date.now()+Math.random();
    if(job.postId && !job.postId.includes('_') && /^\d+$/.test(job.postId) && job.pageId){
      job.postId = job.pageId+'_'+job.postId;
    }
    jobs.push(job);
    saveJobs();
    scheduleJobs();
    console.log(`✅ Nouveau job ${job.id} - ${job.comments.length} coms - reponse 0s`);
    res.json({ok:true, id:job.id, message:'Job ajoute - reponse 0s'});
  }catch(e){ console.error(e); res.status(500).json({error:e.message}); }
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
  console.log(`✅ Backend V4 FINAL sur port ${PORT} - CORS * - Reponse 0s`);
  scheduleJobs();
  try{
    const cron = require('node-cron');
    cron.schedule('* * * * *', ()=>{
      const now=new Date();
      jobs.forEach(job=>{
        const at=new Date(job.scheduledAt);
        if(at<=now && !timers[job.id]){ console.log(`Cron retard ${job.id}`); publishBatch(job); }
      });
    });
    console.log('Cron actif');
  }catch(e){ console.log('Cron non dispo:', e.message); }
});

process.on('uncaughtException', (e)=>{ console.error('uncaughtException:', e); });
process.on('unhandledRejection', (e)=>{ console.error('unhandledRejection:', e); });
