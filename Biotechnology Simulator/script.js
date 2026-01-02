// Cancer Simulator - basic implementation
// Canvas grid where cancer cells can appear and grow based on neighbors.
// Right half of the canvas is a blood vessel where drug particles flow.

const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

const runBtn = document.getElementById('runBtn');
const stopBtn = document.getElementById('stopBtn');
const doseBtn = document.getElementById('doseBtn');

const startAmount = document.getElementById('startAmount');
const growthRate = document.getElementById('growthRate');
const drugAmount = document.getElementById('drugAmount');

const startAmountVal = document.getElementById('startAmountVal');
const growthRateVal = document.getElementById('growthRateVal');
const drugAmountVal = document.getElementById('drugAmountVal');

// grid settings
const spacing = 18; // distance between cell centers (larger spacing -> larger visual cells / smaller-scale scene)
const cols = Math.floor(canvas.width / spacing);
const rows = Math.floor(canvas.height / spacing);
// move vessel slightly to the right and make it narrower
const vesselX = Math.floor(canvas.width * 0.62); // base x for vessel centerline (we will offset per-y)

// vessel shape parameters (diagonal + curvature)
const vesselParams = {
  slope: 0.18,       // diagonal tilt (positive moves boundary to the right towards bottom)
  amplitude: 26,     // sinusoidal amplitude (reduced for less squiggle)
  freq: 0.010,       // frequency of curvature (reduced for gentler curves)
  phase: Math.random()*Math.PI*2,
};

// particle motion tuning and helpers
// increase speeds so drug travels faster
const vesselSpeedBase = 3.2; // base speed for particles moving inside vessel (increased)
const leechSpeedBase = 2.4;   // base speed when particle leeches into muscle (increased)

// images for compound and Y (use provided images in the Images/ folder)
const imgCompound = new Image(); imgCompound.src = 'Images/BsADC Compound.png';
const imgY = new Image(); imgY.src = 'Images/Cytotoxic Drug.png';

function vesselTangentDerivative(y){
  // derivative dx/dy of vesselBoundaryX at y (analytical)
  return vesselParams.slope + vesselParams.amplitude * vesselParams.freq * Math.cos(vesselParams.freq * y + vesselParams.phase);
}

function normalized(vx, vy){
  const m = Math.hypot(vx, vy) || 1;
  return {x: vx/m, y: vy/m};
}

let cells = [];
let particles = [];
let running = false;
let tickInterval = null;

function stepSimulation(){
  // growth
  const newStates = new Array(cells.length).fill(0);
  for(let i=0;i<cells.length;i++){
    const c = cells[i];
    // existing cancer persists
    if(c.state===1){ newStates[i]=1; newStates[i+'_size']=c.size; continue; }
    // skip growth inside vessel
    if(isInVesselXY(c.x, c.y)) continue;
    const neigh = neighborsCount(i);
    if(neigh>0){
      // slow down cancer growth significantly
      const g = Number(growthRate.value) / 15000.0; // much smaller growth per neighbor
      const prob = 1 - Math.pow(1-g, neigh);
      if(Math.random() < prob){ newStates[i]=1; }
    }
  }
  // apply
  for(let i=0;i<cells.length;i++){
    if(newStates[i]===1 && cells[i].state===0){
      cells[i].state = 1; cells[i].size = 6 + Math.random()*10; // larger default size for grown cells
    }
  }

  // move drug particles and handle interactions. Collect newly spawned particles separately to avoid modifying array while iterating.
  const spawned = [];
  for(let i=0;i<particles.length;i++){
    const part = particles[i];

    // age and TTL
    part.ttl = (part.ttl === undefined) ? 300 : part.ttl - 1;
    if(part.ttl <= 0){ part.dead = true; continue; }

    // Ensure Y particles head directly to their assigned tumor target (no wandering)
    if(part.type === 'Y' && part.targetIdx !== undefined && !part.idle){
      const tgt = cells[part.targetIdx];
      if(tgt && tgt.state===1){
        const dirTo = normalized(tgt.x - part.x, tgt.y - part.y);
        const speed = leechSpeedBase * (1 + Number(drugAmount.value)/120);
        part.vx = dirTo.x * speed;
        part.vy = dirTo.y * speed;
      } else {
        // target gone: become idle and stop moving
        part.idle = true; part.vx = 0; part.vy = 0;
      }
    }

    // Ensure compound particles that have leached head directly to their assigned tumor (no avoidance)
    if(part.type === 'compound' && part.leached && part.targetIdx !== undefined && !part.idle){
      const tgt = cells[part.targetIdx];
      if(tgt && tgt.state===1){
        const dirTo = normalized(tgt.x - part.x, tgt.y - part.y);
        const speed = leechSpeedBase * (1 + Number(drugAmount.value)/120);
        part.vx = dirTo.x * speed;
        part.vy = dirTo.y * speed;
      } else {
        // target died: try to pick a new nearest tumor, otherwise become idle
        let bestIdx = -1, bestD = 1e9;
        for(let ti=0; ti<cells.length; ti++){
          const t = cells[ti]; if(t.state!==1) continue;
          const d = Math.hypot(t.x - part.x, t.y - part.y);
          if(d < bestD){ bestD = d; bestIdx = ti; }
        }
        if(bestIdx >= 0){ part.targetIdx = bestIdx; }
        else { part.idle = true; part.vx = 0; part.vy = 0; }
      }
    }

    // Update position
    part.x += part.vx; part.y += part.vy;

    // If particle is still inside vessel, keep it following vessel flow direction (tangent)
    if(!part.leached){
      const boundaryX = vesselBoundaryX(part.y);
      if(part.x <= boundaryX){
        // convert to leached state. Preferentially head toward assigned tumor target if available
        part.leached = true;
        const speed = leechSpeedBase * (1 + Number(drugAmount.value)/120);
        if(part.type === 'compound' && part.targetIdx !== undefined){
          const tgt = cells[part.targetIdx];
          if(tgt && tgt.state===1){
            const dirTo = normalized(tgt.x - part.x, tgt.y - part.y);
            part.vx = dirTo.x * speed;
            part.vy = dirTo.y * speed;
          } else {
            // fallback: push perpendicular into muscle
            const dxdy = vesselTangentDerivative(part.y);
            let nx = -1, ny = dxdy;
            const nn = normalized(nx, ny);
            if(nn.x > 0){ nn.x = -nn.x; nn.y = -nn.y; }
            part.vx = nn.x * speed;
            part.vy = nn.y * speed;
          }
        } else {
          // non-targeted particles: push perpendicular into muscle
          const dxdy = vesselTangentDerivative(part.y);
          let nx = -1, ny = dxdy;
          const nn = normalized(nx, ny);
          if(nn.x > 0){ nn.x = -nn.x; nn.y = -nn.y; }
          part.vx = nn.x * speed;
          part.vy = nn.y * speed;
        }
      } else {
        // re-align velocity to follow vessel tangent (helps when vessel curves)
        const dxdy = vesselTangentDerivative(part.y);
        const dir = normalized(-1, -dxdy);
        // if this particle is targeting tumor, slightly adjust velocity toward target
        if(part.type === 'compound' && part.targetIdx !== undefined){
          const tgt = cells[part.targetIdx];
          if(tgt){
            const toTx = tgt.x - part.x; const toTy = tgt.y - part.y;
            const tdir = normalized(toTx, toTy);
            // use a straightforward mix: alpha controls target influence (higher alpha -> more direct targeting)
            const alpha = (part.steerAggression !== undefined) ? part.steerAggression : 0.9;
            const mixX = dir.x * (1 - alpha) + tdir.x * alpha;
            const mixY = dir.y * (1 - alpha) + tdir.y * alpha;
            const nd = normalized(mixX, mixY);
            const speed = vesselSpeedBase * (1 + Number(drugAmount.value)/80) * (1 + (alpha-0.5)*0.4);
            part.vx = nd.x * speed;
            part.vy = nd.y * speed;
          } else {
            const speed = vesselSpeedBase * (1 + Number(drugAmount.value)/80);
            part.vx = dir.x * speed;
            part.vy = dir.y * speed;
          }
        } else {
          const speed = vesselSpeedBase * (1 + Number(drugAmount.value)/80);
          part.vx = dir.x * speed;
          part.vy = dir.y * speed;
        }
      }
    }

    // Interaction: if compound in muscle contacts a cancer cell -> split into 4 Y particles inside that cell
    if(part.type === 'compound' && part.leached){
      for(let cIdx=0; cIdx<cells.length; cIdx++){
        const c = cells[cIdx];
        if(c.state===1){
          const d = Math.hypot(c.x - part.x, c.y - part.y);
          if(d <= c.size + 9){
            // kill the contacted cell immediately
            c.state = 0; c.size = 0;
            // Determine neighboring tumor cells for this cell
            const neighborTumors = neighborTumorIndicesForCellIdx(cIdx);
            // spawn exactly 4 Y particles and preferentially target adjacent tumors (leech into neighbors)
            // distribute targets across neighbors when possible
            for(let k=0;k<4;k++){
              const rx = c.x + (Math.random()-0.5) * c.size * 0.45;
              const ry = c.y + (Math.random()-0.5) * c.size * 0.45;
              const sp = 0.9 + Math.random()*0.4;
              if(neighborTumors.length > 0){
                // pick neighbor in round-robin to spread Ys across adjacent cells
                const tIdx = neighborTumors[k % neighborTumors.length];
                const t = cells[tIdx];
                // if that neighbor is a tumor, kill it immediately upon Y appearance
                if(t && t.state === 1){
                  t.state = 0; t.size = 0;
                  // 30% chance to additionally kill one of its neighbors immediately
                  const nextNeighbors = neighborTumorIndicesForCellIdx(tIdx);
                  if(nextNeighbors.length > 0 && Math.random() < 0.30){
                    const pick = nextNeighbors[Math.floor(Math.random()*nextNeighbors.length)];
                    if(cells[pick] && cells[pick].state === 1){ cells[pick].state = 0; cells[pick].size = 0; }
                  }
                  // spawn a short-lived visual Y at that neighbor location
                  spawned.push({x: t.x + (Math.random()-0.5)*t.size*0.4, y: t.y + (Math.random()-0.5)*t.size*0.4, vx:0, vy:0, type:'Y', ttl:80, leached:true, idle:true, parentIdx: cIdx});
                } else {
                  const dir = normalized(t.x - rx, t.y - ry);
                  spawned.push({x:rx, y:ry, vx: dir.x * sp, vy: dir.y * sp, type:'Y', ttl:220, leached:true, targetIdx: tIdx, parentIdx: cIdx});
                }
              } else {
                // no adjacent tumors: do not leech into muscle — fallback to nearest tumor if any
                let bestIdx = -1, bestD = 1e9;
                for(let ti=0; ti<cells.length; ti++){
                  const tt = cells[ti]; if(tt.state!==1) continue;
                  const d = Math.hypot(tt.x - rx, tt.y - ry);
                  if(d < bestD){ bestD = d; bestIdx = ti; }
                }
                if(bestIdx >= 0){
                  const t = cells[bestIdx];
                  const dir = normalized(t.x - rx, t.y - ry);
                  spawned.push({x:rx, y:ry, vx: dir.x * sp, vy: dir.y * sp, type:'Y', ttl:220, leached:true, targetIdx: bestIdx, parentIdx: cIdx});
                } else {
                  // no tumor anywhere: Y stays inside cell and decays
                  spawned.push({x:rx, y:ry, vx:0, vy:0, type:'Y', ttl:80, leached:true, idle:true, parentIdx: cIdx});
                }
              }
            }
            part.dead = true;
            break;
          }
        }
      }

    // Y particle behavior: when Y contacts a cancer cell it kills that cell, and may leak into neighbors
    // Y particle behavior: when Y contacts a cancer cell it kills that cell, and may leak into neighbors
    if(part.type === 'Y'){
      // If this Y has a specific target index, only check that target
      if(part.targetIdx !== undefined){
        const tgt = cells[part.targetIdx];
        if(tgt && tgt.state===1){
          const d = Math.hypot(tgt.x - part.x, tgt.y - part.y);
          if(d <= tgt.size + 10){
            // Y kills its target cell
            tgt.state = 0; tgt.size = 0;
            // also kill the parent cell (the one compound originally entered) if present
            if(part.parentIdx !== undefined && cells[part.parentIdx] && cells[part.parentIdx].state === 1){
              cells[part.parentIdx].state = 0; cells[part.parentIdx].size = 0;
            }
            // after killing the target, each Y has a 30% chance to immediately go into one adjacent tumor and kill it
            const neighborIdxs = neighborTumorIndicesForCellIdx(part.targetIdx);
            if(neighborIdxs.length > 0 && Math.random() < 0.30){
              const pick = neighborIdxs[Math.floor(Math.random()*neighborIdxs.length)];
              if(cells[pick] && cells[pick].state === 1){
                cells[pick].state = 0; cells[pick].size = 0;
              }
            }
            part.dead = true;
          }
        } else {
          // target no longer exists, expire this particle
          part.dead = true;
        }
      } else {
        // Y without a target: behave like before but only interact if inside a cancer cell (kill and attempt leaks)
        for(let cIdx=0;cIdx<cells.length;cIdx++){
          const c = cells[cIdx];
          if(c.state===1){
            const d = Math.hypot(c.x - part.x, c.y - part.y);
            if(d <= c.size + 10){
              c.state = 0; c.size = 0;
              const neighborIdxs = neighborTumorIndicesForCellIdx(cIdx);
              // 30% chance to immediately kill one adjacent tumor cell
              if(neighborIdxs.length > 0 && Math.random() < 0.30){
                const pick = neighborIdxs[Math.floor(Math.random()*neighborIdxs.length)];
                if(cells[pick] && cells[pick].state === 1){ cells[pick].state = 0; cells[pick].size = 0; }
              }
              part.dead = true;
              break;
            }
          }
        }
      }
    }

    // wandering particles have a chance to die off each tick
    if(part.wander && Math.random() < 0.015) { part.dead = true; }

    // remove particle when it's off-canvas or spent
    if(part.x < -40 || part.x > canvas.width+40 || part.y < -40 || part.y > canvas.height+40) part.dead = true;
  }
  // append spawned particles but cap total particles to prevent blowup
  const MAX_PARTICLES = 1200;
  if(particles.length + spawned.length > MAX_PARTICLES){
    const allowed = Math.max(0, MAX_PARTICLES - particles.length);
    particles = particles.concat(spawned.slice(0, allowed));
  } else {
    particles = particles.concat(spawned);
  }
  // finally filter out dead
  particles = particles.filter(p => !p.dead);
}

function interactWithWall(p){
  // find cancer cells near hit point
  const killRadius = 26;
  const nearby = cells.filter(c => c.state===1 && !isInVesselXY(c.x,c.y) && Math.hypot(c.x - p.x, c.y - p.y) <= killRadius);
  if(nearby.length>0){
    const target = nearby[Math.floor(Math.random()*nearby.length)];
    // kill target
    target.state = 0; target.size = 0;
    // chance to kill neighbors based on drug amount
    const extraChance = Number(drugAmount.value)/200; // 0..0.5
    // kill neighbors of target
    // find index of target
    const tIdx = Math.round((target.y - spacing/2)/spacing) * cols + Math.round((target.x - spacing/2)/spacing);
    const tx = tIdx % cols; const ty = Math.floor(tIdx/cols);
    for(let oy=-1;oy<=1;oy++){
      for(let ox=-1;ox<=1;ox++){
        if(ox===0 && oy===0) continue;
        const idx = cellIndex(tx+ox, ty+oy);
        if(idx>=0 && cells[idx].state===1){
          if(Math.random() < extraChance){ cells[idx].state=0; cells[idx].size=0; }
        }
      }
    }
  }
}

window.spawnDrugParticles = function(dose){
  // spawn number proportional to supplied dose value (manual dosing)
  const amount = Number(dose);
  if(!amount || amount <= 0) return;
  // number of compounds to spawn for this dose: spawn exactly the slider value
  const toSpawn = Math.max(1, Math.round(amount));
  for(let i=0;i<toSpawn;i++){
    const y = Math.random()*canvas.height;
    const boundaryX = vesselBoundaryX(y);
    const x = boundaryX + 4 + Math.random()*(canvas.width - boundaryX - 4); // inside vessel area
    // decide if this particle will target tumor or wander
    // reduce wander so almost all particles actively target tumors
    const wanderChance = 0.02 + Math.random()*0.01; // ~2-3% wander
    const wander = Math.random() < wanderChance;
    // determine initial velocity
    let vx = 0, vy = 0;
    if(!wander){
      // find nearest cancer cell to target
      // find nearest cancer cell to target (return index for robustness)
      let bestIdx = -1; let bestD = 1e9;
      for(let ti=0; ti<cells.length; ti++){
        const t = cells[ti]; if(t.state!==1) continue;
        const d = Math.hypot(t.x - x, t.y - y);
        if(d < bestD){ bestD = d; bestIdx = ti; }
      }
      if(bestIdx >= 0){
        const best = cells[bestIdx];
        const dirTo = normalized(best.x - x, best.y - y);
        const speed = vesselSpeedBase * (1 + amount/80) * (0.95 + Math.random()*0.2);
        vx = dirTo.x * speed; vy = dirTo.y * speed;
        // set high steering aggression so compound heads straight for tumor
        particles.push({x,y,vx,vy,leached:false,type:'compound',hasC:true,targetIdx:bestIdx,wander:false,ttl:400,steerAggression:0.92});
        continue;
      }
    }
    // wandering or no tumor found: random direction, shorter life
    const ang = Math.random()*Math.PI*2;
    const sp = (vesselSpeedBase*0.6) * (0.6 + Math.random()*0.8);
    vx = Math.cos(ang)*sp; vy = Math.sin(ang)*sp;
    particles.push({x,y,vx,vy,leached:false,type:'compound',hasC:true,wander:true,ttl:120});
  }
  }
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // draw tissue background
  ctx.fillStyle = '#f7f7f7';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // draw vessel as a curved/diagonal band (fill area to the right of boundary)
  ctx.fillStyle = 'rgba(255,200,200,0.6)';
  ctx.beginPath();
  // start at top-right corner
  ctx.moveTo(canvas.width, 0);
  ctx.lineTo(vesselBoundaryX(0), 0);
  // boundary downwards
  for(let y=0; y<=canvas.height; y+=4){
    ctx.lineTo(vesselBoundaryX(y), y);
  }
  ctx.lineTo(canvas.width, canvas.height);
  ctx.closePath();
  ctx.fill();

  // draw healthy muscle cells on the left side (grid - skip vessel area)
  const healthyFill = '#ffd6da';
  const healthyStroke = '#ff9aa2';
  const healthyOrg = '#ff8a90';
  // make healthy cells bigger so they touch/overlap slightly
  const healthyRadius = Math.max(6, spacing * 0.48);
  for(const c of cells){
    if(isInVesselXY(c.x, c.y)) continue; // skip inside vessel
    // draw healthy background cell
    ctx.beginPath();
  ctx.fillStyle = healthyFill;
  ctx.strokeStyle = healthyStroke;
  ctx.lineWidth = 1.6;
    ctx.arc(c.x, c.y, healthyRadius, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // organelle for healthy cell
    const orgR = healthyRadius * 0.30;
    ctx.beginPath(); ctx.fillStyle = healthyOrg; ctx.arc(c.x, c.y, orgR, 0, Math.PI*2); ctx.fill();
  }

  // draw cancer cells on top (cancer cells are larger and white with a darker organelle)
  const cancerOrg = '#999999';
  for(const c of cells){
    if(c.state===1){
      // ensure cancer drawn even if touching vessel border (but skip true vessel interior)
      if(isInVesselXY(c.x, c.y)) continue;
  const r = c.size || (healthyRadius * 1.5);
  // draw cancer cell with light grey wall/stroke
  ctx.beginPath(); ctx.fillStyle = '#ffffff'; ctx.arc(c.x, c.y, r, 0, Math.PI*2); ctx.fill();
  ctx.lineWidth = 2.0; ctx.strokeStyle = 'rgba(180,180,180,0.9)'; ctx.stroke();
  // organelle inside cancer cell (darker circle ~30% of size)
  const orgR = r * 0.30;
  ctx.beginPath(); ctx.fillStyle = cancerOrg; ctx.arc(c.x, c.y, orgR, 0, Math.PI*2); ctx.fill();
    }
  }

  // draw vessel wall line
  ctx.strokeStyle = 'rgba(150,0,0,0.2)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(vesselBoundaryX(0),0);
  for(let y=0;y<=canvas.height;y+=4) ctx.lineTo(vesselBoundaryX(y), y);
  ctx.stroke();

  // draw particles (use images if provided, otherwise fallback to letters)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for(const p of particles){
    if(p.type === 'compound'){
      // draw compound image; enlarge for visibility
      const w = 56, h = 56;
      if(imgCompound.complete && imgCompound.naturalWidth){
        // maintain aspect ratio if image is not square
        const aspect = imgCompound.naturalWidth / imgCompound.naturalHeight || 1;
        const drawW = w * aspect;
        const drawH = h;
        ctx.drawImage(imgCompound, p.x - drawW/2, p.y - drawH/2, drawW, drawH);
      } else {
        // fallback: red/blue letters
        ctx.font = '12px monospace';
        ctx.fillStyle = 'rgba(200,30,30,0.95)'; ctx.fillText('C', p.x-6, p.y);
        ctx.fillStyle = p.leached ? 'rgba(40,120,220,0.95)' : 'rgba(0,80,200,0.9)';
        ctx.fillText('Y', p.x+6, p.y);
      }
    } else if(p.type === 'Y'){
      const s = 18;
      if(imgY.complete && imgY.naturalWidth){
        // draw Y circle image
        ctx.drawImage(imgY, p.x - s/2, p.y - s/2, s, s);
      } else {
        ctx.font = '12px monospace';
        ctx.fillStyle = 'rgba(220,180,30,0.95)';
        ctx.fillText('Y', p.x, p.y);
      }
    }
  }
}

// --- helper functions (were missing) ---
function vesselBoundaryX(y){
  // base vertical line shifted by slope and sinusoidal curvature
  return vesselX + vesselParams.slope * y + vesselParams.amplitude * Math.sin(vesselParams.freq * y + vesselParams.phase);
}

function isInVesselXY(x, y){
  return x >= vesselBoundaryX(y);
}

function cellIndex(ix, iy){
  if(ix < 0 || iy < 0 || ix >= cols || iy >= rows) return -1;
  return iy * cols + ix;
}

function neighborsCount(i){
  const c = cells[i];
  const ix = Math.round((c.x - spacing/2) / spacing);
  const iy = Math.round((c.y - spacing/2) / spacing);
  let count = 0;
  for(let oy=-1; oy<=1; oy++){
    for(let ox=-1; ox<=1; ox++){
      if(ox===0 && oy===0) continue;
      const idx = cellIndex(ix+ox, iy+oy);
      if(idx >= 0 && cells[idx] && cells[idx].state === 1) count++;
    }
  }
  return count;
}

// return array of neighbor indices (8-neighborhood) that are tumor cells
function neighborTumorIndicesForCellIdx(idx){
  const c = cells[idx];
  if(!c) return [];
  const ix = Math.round((c.x - spacing/2) / spacing);
  const iy = Math.round((c.y - spacing/2) / spacing);
  const out = [];
  for(let oy=-1; oy<=1; oy++){
    for(let ox=-1; ox<=1; ox++){
      if(ox===0 && oy===0) continue;
      const nidx = cellIndex(ix+ox, iy+oy);
      if(nidx>=0 && cells[nidx] && cells[nidx].state===1) out.push(nidx);
    }
  }
  return out;
}

function initCells(){
  cells = [];
  for(let iy=0; iy<rows; iy++){
    for(let ix=0; ix<cols; ix++){
      const x = spacing/2 + ix * spacing;
      const y = spacing/2 + iy * spacing;
      cells.push({x, y, state: 0, size: 0});
    }
  }
}

function seedInitial(){
  // clear any existing tumor
  for(const c of cells){ c.state = 0; c.size = 0; }
  // number of cells to seed based on slider (scaled)
  const pct = Math.max(0, Math.min(100, Number(startAmount.value)));
  const targetCount = Math.max(3, Math.round((pct/100) * 45));

  // choose a center y near middle and just outside the vessel boundary (muscle side)
  const yc = canvas.height * (0.35 + Math.random()*0.3);
  const bx = vesselBoundaryX(yc);
  const xc = Math.max( spacing, bx - spacing*3 );

  // find nearest grid cell to (xc,yc)
  const centerIx = Math.round((xc - spacing/2) / spacing);
  const centerIy = Math.round((yc - spacing/2) / spacing);
  const startIdx = cellIndex(centerIx, centerIy) >=0 ? cellIndex(centerIx, centerIy) : Math.floor(cells.length/2);

  // simple BFS/expansion to create a connected cluster
  const q = [startIdx];
  const seen = new Set([startIdx]);
  let seeded = 0;
  while(q.length>0 && seeded < targetCount){
    const idx = q.shift();
    if(idx<0 || idx>=cells.length) continue;
    const c = cells[idx];
    if(isInVesselXY(c.x, c.y)) continue; // don't seed inside vessel
    if(c.state===0){
      c.state = 1; c.size = 12 + Math.random()*10; seeded++;
    }
    // push neighbors in random order
    const ix = Math.round((c.x - spacing/2) / spacing);
    const iy = Math.round((c.y - spacing/2) / spacing);
    const neigh = [];
    for(let oy=-1; oy<=1; oy++) for(let ox=-1; ox<=1; ox++) if(!(ox===0 && oy===0)) neigh.push([ix+ox, iy+oy]);
    // shuffle
    for(let i=neigh.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=neigh[i]; neigh[i]=neigh[j]; neigh[j]=t; }
    for(const [nx,ny] of neigh){
      const nidx = cellIndex(nx, ny);
      if(nidx>=0 && !seen.has(nidx)) { seen.add(nidx); q.push(nidx); }
    }
  }
}


function tick(){
  stepSimulation();
  draw();
}

// Manual dosing function: call when user clicks the dose button
function giveDose(){
  const dose = Number(drugAmount.value);
  if(dose <= 0) return;
  spawnDrugParticles(dose);
}

 
function start(){
  if(running) return;
  running = true;
  initCells();
  seedInitial();
  particles = [];
  tickInterval = setInterval(tick, 120);
}

function stop(){
  running = false;
  if(tickInterval) clearInterval(tickInterval);
}

// wire controls
runBtn.addEventListener('click', ()=>{ start(); });
stopBtn.addEventListener('click', ()=>{ stop(); });
// manual dose button
doseBtn && doseBtn.addEventListener('click', ()=>{ giveDose(); });

[startAmount, growthRate, drugAmount].forEach(el=>{
  el.addEventListener('input', ()=>{
    startAmountVal.textContent = startAmount.value + '%';
    growthRateVal.textContent = growthRate.value;
    drugAmountVal.textContent = drugAmount.value;
  });
});

// initialize UI values
startAmountVal.textContent = startAmount.value + '%';
growthRateVal.textContent = growthRate.value;
drugAmountVal.textContent = drugAmount.value;

// prepare initial cells so canvas doesn't error before starting
initCells();
draw();
