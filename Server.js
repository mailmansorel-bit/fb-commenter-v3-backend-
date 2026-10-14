
const express = require('express');
const cron = require('node-cron');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // pour servir frontend si tu veux

const JOBS_FILE = path.join(__dirname, 'jobs.json');
const LOG_FILE = path.join(__dirname, 'logs.txt');

function log(msg){
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(line.trim());
  try{fs.appendFileSync(LOG_FILE, line);}catch(e){}
}

function loadJobs(){
  if(!fs.existsSync(JOBS_FILE)) return [];
  try{return JSON.parse(fs.readFileSync(JOBS_FILE,'utf8'));}catch{return [];}
}
function saveJobs(jobs){
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs,null,2));
}

let jobs = loadJobs();
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

async function publishBatch(job){
  log(`▶️ DEBUT batch ${job.id} - ${job.comments.length} coms sur ${job.postId}`);
  const token = job.token;
  const postId = job.postId;
  for(let i=0;i<job.comments.length;i++){
    const c = job.comments[i];
    const delaySec = i===0?0:getRandomDelaySec();
    if(i>0){
      log(`⏱️ Attente ${delaySec}s avant #${i+1}`);
      await new Promise(r=>setTimeout(r, delaySec*1000));
    }
    try{
      const commentId = await publishComment(postId, c.text, token);
      log(`✅ Com #${i+1} OK ${commentId}`);
      if(c.reply && c.reply.trim()!==''){
        const rd = getRandomReplyDelay();
        log(`↳ Attente ${Math.floor(rd/1000)}s reponse #${i+1}`);
        await new Promise(r=>setTimeout(r, rd));
        const rid = await publishReply(commentId, c.reply, token);
        log(`✅ Reponse #${i+1} OK ${rid}`);
      }
    }catch(e){
      log(`❌ Echec #${i+1}: ${e.message}`);
    }
  }
  log(`🏁 Batch ${job.id} termine - suppression`);
  jobs = jobs.filter(j=>j.id!=job.id);
  saveJobs(jobs);
}

function scheduleJobs(){
  Object.values(timers).forEach(t=>clearTimeout(t));
  timers={};
  jobs.forEach(job=>{
    const at = new Date(job.scheduledAt);
    let ms = at - new Date();
    if(ms<=0){
      log(`⏰ Job ${job.id} EN RETARD -> 3s`);
      timers[job.id]=setTimeout(()=>publishBatch(job),3000);
    }else{
      log(`📅 Job ${job.id} dans ${Math.floor(ms/1000)}s -> ${at.toLocaleString()}`);
      timers[job.id]=setTimeout(()=>publishBatch(job), ms);
    }
  });
}

// ROUTES
app.get('/', (req,res)=>{
  res.send(`
  <h1>Backend V3 Persistant 24/7 OK</h1>
  <p>Jobs: ${jobs.length}</p>
  <ul>
    <li><a href="/jobs">/jobs - liste</a></li>
    <li><a href="/logs">/logs - logs</a></li>
  </ul>
  <p>Frontend V3 peut pousser ici via "Exporter pour backend"</p>
  `);
});

app.get('/jobs', (req,res)=>{res.json(jobs);});
app.get('/logs', (req,res)=>{
  if(fs.existsSync(LOG_FILE)) res.type('text').send(fs.readFileSync(LOG_FILE,'utf8'));
  else res.send('Pas de logs');
});

app.post('/jobs', (req,res)=>{
  const job = req.body;
  job.id = job.id || Date.now()+Math.random();
  if(job.postId && !job.postId.includes('_') && /^\d+$/.test(job.postId) && job.pageId){
    job.postId = job.pageId+'_'+job.postId;
  }
  jobs.push(job);
  saveJobs(jobs);
  scheduleJobs();
  log(`➕ Nouveau job ${job.id} - ${job.comments?.length||0} coms pour ${job.scheduledAt}`);
  res.json({ok:true, id:job.id});
});

app.post('/jobs/import', (req,res)=>{
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
    // Import simple depuis frontend V3
    const job = data;
    job.id = job.id || Date.now()+Math.random();
    jobs.push(job);
    imported=1;
  }
  saveJobs(jobs);
  scheduleJobs();
  log(`📥 Import ${imported} jobs`);
  res.json({ok:true, imported});
});

app.post('/jobs/add-comment/:id', (req,res)=>{
  const job = jobs.find(j=>j.id==req.params.id);
  if(!job) return res.status(404).json({error:'job not found'});
  const newCom = req.body;
  newCom.id = newCom.id || Date.now()+Math.random();
  job.comments.push(newCom);
  saveJobs(jobs);
  log(`➕ Ajout com a job ${job.id} - total ${job.comments.length}`);
  res.json({ok:true, total:job.comments.length});
});

app.delete('/jobs/:id', (req,res)=>{
  jobs = jobs.filter(j=>j.id!=req.params.id);
  if(timers[req.params.id]) clearTimeout(timers[req.params.id]);
  saveJobs(jobs);
  log(`🗑️ Suppression job ${req.params.id}`);
  res.json({ok:true});
});

app.delete('/jobs', (req,res)=>{
  jobs=[]; Object.values(timers).forEach(t=>clearTimeout(t)); timers={}; saveJobs(jobs);
  log(`🗑️ Tous jobs supprimes`);
  res.json({ok:true});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>{
  log(`🚀 Backend V3 persistant sur port ${PORT} - 24/7 meme PC ferme`);
  scheduleJobs();
  cron.schedule('* * * * *', ()=>{
    const now=new Date();
    jobs.forEach(job=>{
      const at=new Date(job.scheduledAt);
      if(at<=now && !timers[job.id]){
        log(`Cron detecte retard ${job.id}`);
        publishBatch(job);
      }
    });
  });
});
