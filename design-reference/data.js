/* ============================================================
   Ossett Training Hub — mock data + taxonomy
   Exposes window.OTJ = { drills, media, templates, sessions, tax }
   ============================================================ */
(function () {
  // ---- Taxonomy --------------------------------------------------
  const CORNERS = {
    technical:    { key: "technical",    label: "Technical",     short: "TEC", color: "var(--c-technical)" },
    physical:     { key: "physical",     label: "Physical",      short: "PHY", color: "var(--c-physical)" },
    social:       { key: "social",       label: "Social",        short: "SOC", color: "var(--c-social)" },
    psychological:{ key: "psychological",label: "Psychological", short: "PSY", color: "var(--c-psych)" },
  };
  const cornerClass = { technical: "technical", physical: "physical", social: "social", psychological: "psych" };

  const PHASES = ["Warm-Up", "Skill", "Game", "Cool-Down"];
  const SKILLS = ["Dribbling","Passing","Shooting","Ball Mastery","1v1","Turning","Defending","Goalkeeping","Movement","Fun Game"];
  const AGES = ["U6","U7","U8","U9","U10","U11","U12"];
  const LEVELS = ["Foundation","Developing","Advanced"];

  // ---- Media -----------------------------------------------------
  const media = [
    { id:"m1", name:"Dynamic Warm-Up.mp4",        type:"video",   kind:"pitch",   size:"10.1 MB", dims:"640×480", length:"1:32", usedIn:3 },
    { id:"m2", name:"Protect The Bib.mp4",        type:"video",   kind:"pitch",   size:"10.1 MB", dims:"640×480", length:"2:08", usedIn:1 },
    { id:"m3", name:"Six Second Game.png",        type:"image",   kind:"diagram", size:"0.09 MB", dims:"1200×800",          usedIn:1 },
    { id:"m4", name:"Coerver Ball Mastery",       type:"youtube", kind:"pitch",   yt:"https://youtu.be/", length:"4:11", usedIn:2 },
    { id:"m5", name:"1v1 Attacking Moves",        type:"youtube", kind:"pitch",   yt:"https://youtu.be/", length:"6:24", usedIn:1 },
    { id:"m6", name:"Passing Patterns Diagram.png", type:"image", kind:"diagram", size:"0.12 MB", dims:"1400×900",          usedIn:2 },
    { id:"m7", name:"FA Session Card – Possession.pdf", type:"pdf", kind:"pdf",    size:"0.4 MB",  pages:2,                  usedIn:1 },
    { id:"m8", name:"Cool-Down Stretch Routine.pdf",    type:"pdf", kind:"pdf",    size:"0.3 MB",  pages:1,                  usedIn:1 },
    { id:"m9", name:"Sharks & Minnows Setup.png", type:"image",   kind:"diagram", size:"0.10 MB", dims:"1200×800",          usedIn:1 },
    { id:"m10",name:"Rondo 4v1 Clip.mp4",         type:"video",   kind:"pitch",   size:"14.2 MB", dims:"720×480", length:"3:02", usedIn:1 },
  ];
  const mediaById = Object.fromEntries(media.map(m => [m.id, m]));

  // ---- Drills ----------------------------------------------------
  const drills = [
    {
      id:"d1", title:"Sharks & Minnows", corner:"technical", skill:"Dribbling",
      ages:["U6","U7","U8"], level:"Foundation", duration:8, players:"Whole group",
      area:"20×20m", equipment:["Cones","1 ball each","Bibs"], mediaId:"m9",
      summary:"Classic dribbling chaos game — minnows dribble across, sharks try to knock balls out.",
      points:["Eyes up, find the space","Small, close touches under pressure","Use both feet to change direction","Shield the ball when a shark gets close"],
      tags:["fun","close control","ABCs"]
    },
    {
      id:"d2", title:"Dynamic Warm-Up", corner:"physical", skill:"Movement",
      ages:["U6","U7","U8","U9","U10"], level:"Foundation", duration:10, players:"Whole group",
      area:"15×15m", equipment:["Cones"], mediaId:"m1",
      summary:"Pulse-raiser with footwork, skips and gentle ball rolls to get bodies ready.",
      points:["Light on toes, stay active","Good range of movement at the joints","Build intensity gradually","Add a ball for the second half"],
      tags:["warm-up","coordination","ABCs"]
    },
    {
      id:"d3", title:"Coerver Ball Mastery", corner:"technical", skill:"Ball Mastery",
      ages:["U7","U8","U9","U10","U11"], level:"Developing", duration:12, players:"1 ball each",
      area:"Grid 10×10m", equipment:["1 ball each","Cones"], mediaId:"m4",
      summary:"Footwork patterns — toe taps, rolls, V-pulls and step-overs to build comfort on the ball.",
      points:["Quality over speed first","Both feet, every rep","Head up between touches","Add speed once the pattern is clean"],
      tags:["technique","footwork","repetition"]
    },
    {
      id:"d4", title:"Win The Ball Back In 6", corner:"social", skill:"Defending",
      ages:["U9","U10","U11","U12"], level:"Developing", duration:12, players:"Teams of 4-6",
      area:"30×20m", equipment:["Cones","Balls","Bibs"], mediaId:"m3",
      summary:"Lose the ball? Whole team presses to win it back within 6 seconds — points for fast recovery.",
      points:["React instantly when possession is lost","Press as a unit, close the nearest option","Communicate — who goes, who covers","Celebrate the recovery as a team"],
      tags:["counter-press","teamwork","transitions"]
    },
    {
      id:"d5", title:"1v1 Attacking Moves", corner:"psychological", skill:"1v1",
      ages:["U8","U9","U10","U11"], level:"Developing", duration:14, players:"Pairs",
      area:"10×8m channels", equipment:["Cones","Balls"], mediaId:"m5",
      summary:"Take players on with confidence — commit the defender, then explode past into space.",
      points:["Attack the defender, don't wait","Sell the feint with your body","Change of pace is the move","Be brave — try, fail, try again"],
      tags:["confidence","beating a player","decision-making"]
    },
    {
      id:"d6", title:"Rondo 4v1", corner:"technical", skill:"Passing",
      ages:["U9","U10","U11","U12"], level:"Developing", duration:10, players:"5 per grid",
      area:"8×8m grid", equipment:["Cones","1 ball","Bibs"], mediaId:"m10",
      summary:"Keep-ball in a tight grid — quick passing and movement to beat the defender in the middle.",
      points:["Open body shape to see two options","Pass to feet, weight it right","Move after you pass","First touch out of pressure"],
      tags:["possession","first touch","scanning"]
    },
    {
      id:"d7", title:"Traffic Lights", corner:"physical", skill:"Ball Mastery",
      ages:["U6","U7","U8"], level:"Foundation", duration:8, players:"Whole group",
      area:"15×15m", equipment:["1 ball each"], mediaId:null,
      summary:"Red/amber/green calls control dribbling speed — fun way to build close control and listening.",
      points:["Stop the ball dead on 'red'","Tiny touches on 'amber'","Drive into space on 'green'","Keep heads up to hear the call"],
      tags:["fun","listening","close control"]
    },
    {
      id:"d8", title:"Shooting Gallery", corner:"technical", skill:"Shooting",
      ages:["U8","U9","U10","U11","U12"], level:"Developing", duration:12, players:"Groups of 3-4",
      area:"Half pitch + goals", equipment:["Balls","Goals","Cones"], mediaId:"m6",
      summary:"Rotating finishing stations — laces strike, side-foot placement and a 1v1 vs keeper.",
      points:["Plant foot beside the ball","Strike through the middle for laces","Pick your spot for placement","Follow your shot in"],
      tags:["finishing","striking the ball","goals"]
    },
    {
      id:"d9", title:"Possession Squares", corner:"social", skill:"Passing",
      ages:["U10","U11","U12"], level:"Advanced", duration:14, players:"Teams of 5-6",
      area:"30×30m", equipment:["Cones","Balls","Bibs"], mediaId:"m7",
      summary:"Two teams compete to keep the ball — string 6 passes together to score a point.",
      points:["Create angles to support the ball","Scan before you receive","Switch play to the free side","Talk constantly — demand the ball"],
      tags:["possession","support play","communication"]
    },
    {
      id:"d10", title:"Cool-Down & Stretch", corner:"physical", skill:"Movement",
      ages:["U6","U7","U8","U9","U10","U11","U12"], level:"Foundation", duration:6, players:"Whole group",
      area:"Anywhere", equipment:[], mediaId:"m8",
      summary:"Gentle jog, static stretches and a quick chat about what went well today.",
      points:["Bring the heart rate down gradually","Hold each stretch ~15 seconds","Reflect: one thing we did well","End on a positive note"],
      tags:["cool-down","recovery","reflection"]
    },
    {
      id:"d11", title:"Turning Gates", corner:"technical", skill:"Turning",
      ages:["U7","U8","U9","U10"], level:"Foundation", duration:10, players:"1 ball each",
      area:"15×15m gates", equipment:["Cones","1 ball each"], mediaId:null,
      summary:"Dribble to a gate, perform a turn (Cruyff, drag-back, hook) and drive out the other side.",
      points:["Decide your turn early","Protect the ball through the turn","Accelerate out of it","Try a new turn each round"],
      tags:["turning","close control","variety"]
    },
    {
      id:"d12", title:"Keeper Reaction Saves", corner:"psychological", skill:"Goalkeeping",
      ages:["U9","U10","U11","U12"], level:"Developing", duration:10, players:"GK + servers",
      area:"One goal", equipment:["Balls","Goal","Gloves"], mediaId:null,
      summary:"Rapid-fire shots from short range to sharpen reactions, set position and bravery.",
      points:["Set before the shot — feet ready","Strong hands behind the ball","Brave, get your body behind it","Reset quickly for the next one"],
      tags:["goalkeeping","reactions","bravery"]
    },
  ];
  const drillById = Object.fromEntries(drills.map(d => [d.id, d]));

  // ---- Templates -------------------------------------------------
  const templates = [
    { id:"t1", name:"Standard Training Night", author:"Sarah Thompson", focus:"All-round",
      activities:[
        { phase:"Warm-Up", drillId:"d2", duration:10 },
        { phase:"Skill",   drillId:"d3", duration:12 },
        { phase:"Skill",   drillId:"d11", duration:10 },
        { phase:"Game",    drillId:"d4", duration:12 },
        { phase:"Cool-Down", drillId:"d10", duration:6 },
      ] },
    { id:"t2", name:"Dribbling & 1v1 Focus", author:"Sarah Thompson", focus:"Technical / Confidence",
      activities:[
        { phase:"Warm-Up", drillId:"d7", duration:8 },
        { phase:"Skill",   drillId:"d1", duration:10 },
        { phase:"Skill",   drillId:"d5", duration:14 },
        { phase:"Game",    drillId:"d1", duration:10 },
        { phase:"Cool-Down", drillId:"d10", duration:6 },
      ] },
    { id:"t3", name:"Possession & Passing", author:"Dev Manager", focus:"Technical / Social",
      activities:[
        { phase:"Warm-Up", drillId:"d2", duration:10 },
        { phase:"Skill",   drillId:"d6", duration:10 },
        { phase:"Game",    drillId:"d9", duration:14 },
        { phase:"Cool-Down", drillId:"d10", duration:6 },
      ] },
  ];

  // ---- Sessions (planned) ---------------------------------------
  const sessions = [
    { id:"s1", name:"Tuesday Training", date:"2026-06-09", time:"17:30", ageGroup:"U8s", venue:"Springmill 3G",
      focus:"Dribbling & 1v1", status:"upcoming",
      activities:[
        { phase:"Warm-Up", drillId:"d2", duration:10 },
        { phase:"Skill",   drillId:"d1", duration:8 },
        { phase:"Skill",   drillId:"d5", duration:14 },
        { phase:"Game",    drillId:"d4", duration:12 },
        { phase:"Cool-Down", drillId:"d10", duration:6 },
      ] },
    { id:"s2", name:"Thursday Skills", date:"2026-06-11", time:"17:30", ageGroup:"U8s", venue:"Springmill 3G",
      focus:"Passing & Possession", status:"upcoming",
      activities:[
        { phase:"Warm-Up", drillId:"d7", duration:8 },
        { phase:"Skill",   drillId:"d6", duration:10 },
        { phase:"Skill",   drillId:"d3", duration:12 },
        { phase:"Game",    drillId:"d9", duration:14 },
        { phase:"Cool-Down", drillId:"d10", duration:6 },
      ] },
    { id:"s3", name:"Saturday Pre-Match", date:"2026-06-13", time:"09:30", ageGroup:"U8s", venue:"Springmill Pitch 1",
      focus:"Activation & Shooting", status:"upcoming",
      activities:[
        { phase:"Warm-Up", drillId:"d2", duration:10 },
        { phase:"Skill",   drillId:"d8", duration:12 },
        { phase:"Game",    drillId:"d4", duration:10 },
      ] },
  ];

  function sessionMinutes(s){ return s.activities.reduce((a,x)=>a+(x.duration||0),0); }

  window.OTJ = {
    CORNERS, cornerClass, PHASES, SKILLS, AGES, LEVELS,
    media, mediaById, drills, drillById, templates, sessions,
    sessionMinutes,
  };
})();
