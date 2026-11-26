import { useState, useEffect, useRef } from '../../core/ui/react.ts'
import { get } from '../../core/api/api.ts'
import { Btn, Card, h, usePersisted } from '../../core/ui/ui.ts'

const SM_REGION = {
  person: { label: '人物', color: '#6ee7ff' },
  event: { label: '经历', color: '#ff9ecd' },
  core: { label: '核心', color: '#ffd166' },
  // 深色底上原色太淡（#a9bcd8 / #5b6678 / #8b93a7 几乎融进背景），统一提亮
  knowledge: { label: '知识', color: '#7fb2f0' },
  outdated: { label: '已过时', color: '#8a97ab' },
  archived: { label: '已归档', color: '#a9b6cb' },
}

const SM_TIER_LABEL = { short: '临时', long: '长期', core: '永久' }

const SM_EDGE_KINDS = { person: '同一个人', tag: '同标签', similar: '内容相似', conflict: '冲突', assoc: '联想' }

const SM_EDGE_WHITE = '220, 230, 245'

const SM_CHILD_TINTS = ['255, 159, 200', '127, 212, 255', '255, 209, 102', '167, 139, 250', '134, 239, 172', '240, 166, 202', '186, 146, 255']

const SM_GROUP_TINTS = ['255, 209, 102', '134, 239, 172', '127, 212, 255', '255, 159, 200', '167, 139, 250', '255, 160, 122', '186, 146, 255', '248, 113, 113']

const smClamp = (n, min, max) => Math.min(max, Math.max(min, n))
/** 星图搜索/筛选：记忆星图渲染前统一判一次，避免筛选逻辑和渲染各写一套（#85）。 */

const smStarMatches = (s, query = '', typeFilter = '', quickFilter = '', nowMs = Date.now()) => {
  const q = String(query || '').trim().toLowerCase()
  if (q) {
    const hay = [s.text, s.about, s.aboutName, ...(Array.isArray(s.tags) ? s.tags : [])].join(' ').toLowerCase()
    if (!hay.includes(q)) return false
  }
  if (typeFilter) {
    if (typeFilter === 'archived') { if (!s.archivedAt) return false }
    else if (typeFilter === 'outdated') { if (!s.invalidAt || s.archivedAt) return false }
    else if (typeFilter === 'core') { if (s.tier !== 'core' && s.region !== 'core') return false }
    else if (s.region !== typeFilter) return false
  }
  if (quickFilter === 'dim' && !(Number(s.brightness) < 0.35)) return false
  if (quickFilter === 'recent') {
    const at = Number(s.lastHit || s.at || 0)
    if (!at || nowMs - at > 7 * 86400_000) return false
  }
  return true
}

const smTintIndexOf = (id) => {
  const text = String(id || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return hash % SM_GROUP_TINTS.length
}

// 按 id 哈希取色，撞色时顺延到下一个空位，保证这批模块颜色互不相同。
const smTintMapOf = (groups = []) => {
  const map = new Map()
  const used = new Set()
  groups.forEach((group) => {
    let index = smTintIndexOf(group.id)
    for (let step = 0; step < SM_GROUP_TINTS.length; step += 1) {
      const candidate = (index + step) % SM_GROUP_TINTS.length
      if (!used.has(candidate)) { index = candidate; break }
    }
    used.add(index)
    map.set(group.id, SM_GROUP_TINTS[index])
  })
  return map
}

const smShortText = (v, n = 12) => (String(v || '').length > n ? String(v || '').slice(0, n) + '…' : String(v || ''))

const SM_DUST = Array.from({ length: 140 }, (_, i) => {
  const a = Math.imul(i + 3, 1103515245) >>> 0
  const b = Math.imul(i + 11, 12345) >>> 0
  return { x: (a % 1000) / 1000, y: (b % 1000) / 1000, size: 0.6 + ((a >>> 8) % 100) / 100 * 1.2 }
})

// 会缓慢流动的远景星场：不同深度、不同速度，像一片在飘的星空。
const SM_FLOW = Array.from({ length: 160 }, (_, i) => {
  const a = Math.imul(i + 7, 2654435761) >>> 0
  const b = Math.imul(i + 19, 40503) >>> 0
  const c = Math.imul(i + 31, 1103515245) >>> 0
  const z = 0.35 + ((a >>> 8) % 100) / 100 * 0.65
  return { x: (a % 1000) / 1000, y: (b % 1000) / 1000, z, size: 0.5 + (((c >>> 8) % 100) / 100) * 1.1, speed: 0.006 + z * 0.022, warm: (c % 100) > 78 }
})

function smDraw(ctx, { W, H, stars, layout, stats, edges, view, opt, bgCanvas, glowCanvas, hover, labelBoxes, labelSeen, now }) {
  const layoutGroups = (layout && layout.groups) || []
  const boxHit = (x, y, w, h) => labelBoxes.current.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 && Math.abs(b.y - y) < (b.h + h) / 2)

  // ── 背景层：只在尺寸变化时重画 ──
  if (bgCanvas.width !== W || bgCanvas.height !== H) {
    bgCanvas.width = W
    bgCanvas.height = H
    const bg = bgCanvas.getContext('2d')
    bg.fillStyle = '#050a14'
    bg.fillRect(0, 0, W, H)
    for (const [x, y, r, cr, cg, cb, alpha] of [[0.3, 0.28, 0.55, 72, 98, 210, 0.18], [0.74, 0.2, 0.4, 132, 74, 186, 0.12], [0.58, 0.8, 0.6, 40, 112, 168, 0.1]]) {
      const g = bg.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * Math.min(W, H))
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`)
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
      bg.fillStyle = g
      bg.fillRect(0, 0, W, H)
    }
    for (const d of SM_DUST) {
      bg.fillStyle = `rgba(150,180,230,${0.05 + d.size * 0.1})`
      bg.fillRect(d.x * W, d.y * H, d.size, d.size)
    }
  }
  ctx.drawImage(bgCanvas, 0, 0, W, H)
  if (opt.motion) {
    // 背景不逐帧闪：星尘固定亮度，流动星场只保留很慢的漂移。
    for (let i = 0; i < SM_DUST.length; i += 5) {
      const d = SM_DUST[i]
      ctx.fillStyle = 'rgba(190,214,245,0.16)'
      ctx.fillRect(d.x * W, d.y * H, 1.2, 1.2)
    }
    const T = now * 0.001
    for (const f of SM_FLOW) {
      const x = (((f.x + T * f.speed * 0.35) % 1) + 1) % 1
      const y = (((f.y + T * f.speed * 0.1) % 1) + 1) % 1
      const alpha = 0.1 + 0.16 * f.z
      const px = x * W
      const py = y * H
      if (f.z > 0.9 && f.size > 1.2) {
        ctx.strokeStyle = `rgba(190,214,245,${alpha * 0.3})`
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(px - f.speed * W * 0.2, py - f.speed * H * 0.05)
        ctx.stroke()
      }
      ctx.fillStyle = f.warm ? `rgba(255,226,190,${alpha})` : `rgba(190,214,245,${alpha})`
      ctx.fillRect(px, py, f.size, f.size)
    }
  }

  const R = (layout && layout.radius) || 470
  const camZ = R * 3 * view.camScale
  const cyw = Math.cos(view.yaw), syw = Math.sin(view.yaw)
  const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch)
  const focal = Math.min(W, H) * 0.95
  const project = (p) => {
    const worldX = p.x - view.cam.x
    const worldY = p.y - view.cam.y
    const worldZ = p.z - view.cam.z
    const x1 = worldX * cyw + worldZ * syw
    const z1 = -worldX * syw + worldZ * cyw
    const y2 = worldY * cp - z1 * sp
    const z2 = worldY * sp + z1 * cp
    const depth = camZ - z2
    if (depth < 60) return null
    const k = focal * view.zoom / depth
    return { x: W / 2 + x1 * k, y: H / 2 - y2 * k, k, depth, t: smClamp((z2 / R + 1) / 2, 0, 1) }
  }
  const proj = new Map()
  for (const star of stars) { const p = project(star); if (p) proj.set(star.id, p) }
  // 局部深度因子：project 里的 p.t 是「归一化到整个星图半径」的深度，聚焦到某个
  // 子星云后，前后星星的 t 差异只有零点零几，近大远小/深度雾几乎失效，所以放大也
  // 分不清前后两层。这里按当前视野里实际的最近/最远距离重新归一化出 td（1=近、0=远）。
  let minDepth = Infinity, maxDepth = -Infinity
  for (const p of proj.values()) { if (p.depth < minDepth) minDepth = p.depth; if (p.depth > maxDepth) maxDepth = p.depth }
  const depthSpan = Math.max(1, maxDepth - minDepth)
  for (const p of proj.values()) p.td = smClamp((maxDepth - p.depth) / depthSpan, 0, 1)
  // clip=true 时：端点即使跑出画面，也拉回边界外一点继续画，而不是返回 null。
  // 选中某颗星时它的连线常常连到别的子星云/星团（可能在画面外），
  // 若按老逻辑丢弃整条边，用户就看不出这颗星和外面还有连接。
  const edgeEndpoint = (id, clip = false) => {
    const p = proj.get(id)
    if (!p) return null
    const off = p.x < -40 || p.x > W + 40 || p.y < -30 || p.y > H + 30
    if (!off) return p
    if (!clip) return null
    return { x: smClamp(p.x, -24, W + 24), y: smClamp(p.y, -24, H + 24), k: p.k, depth: p.depth, t: p.t }
  }

  const groupTints = smTintMapOf(layoutGroups)
  const starsById = new Map(stars.map((s) => [s.id, s]))
  const nowMs = Date.now()
  const active = Boolean(String(opt.query || '').trim() || opt.typeFilter || opt.quickFilter || opt.tierFilter)
  const matchedIds = new Set(active ? stars.filter((s) => (!opt.tierFilter || (s.tier === opt.tierFilter && !s.archivedAt)) && smStarMatches(s, opt.query, opt.typeFilter, opt.quickFilter, nowMs)).map((s) => s.id) : [])
  const matchedClusters = new Set()
  const clusterRanked = new Map()
  const childRanked = new Map()
  const rankOf = (s) => smClamp(Number(s.hits) || 0, 0, 60) / 60 * 0.62 + smClamp(s.brightness, 0, 1) * 0.24 + smClamp(s.importance, 0, 1) * 0.14
  for (const s of stars) {
    if (active && matchedIds.has(s.id) && s.cluster) matchedClusters.add(s.cluster)
    const rank = rankOf(s)
    const list = clusterRanked.get(s.cluster) || []
    list.push({ id: s.id, rank })
    clusterRanked.set(s.cluster, list)
    if (s.child) {
      const cl = childRanked.get(s.child) || []
      cl.push({ id: s.id, rank })
      childRanked.set(s.child, cl)
    }
  }
  for (const list of clusterRanked.values()) list.sort((a, b) => b.rank - a.rank || (a.id < b.id ? -1 : 1))
  for (const list of childRanked.values()) list.sort((a, b) => b.rank - a.rank || (a.id < b.id ? -1 : 1))
  const childTints = new Map()
  for (const g of layoutGroups) (g.childClusters || []).forEach((child, i) => childTints.set(child.id, SM_CHILD_TINTS[i % SM_CHILD_TINTS.length]))
  const colorOf = (s) => {
    const tint = s.child ? childTints.get(s.child) : ''
    return tint ? `rgb(${tint})` : (SM_REGION[s.region] || SM_REGION.knowledge).color
  }
  const highlightIds = new Set()
  for (const g of layoutGroups) {
    const children = g.childClusters || []
    if (children.length) for (const child of children) (childRanked.get(child.id) || []).slice(0, 3).forEach((e) => highlightIds.add(e.id))
    else (clusterRanked.get(g.id) || []).slice(0, 5).forEach((e) => highlightIds.add(e.id))
  }
  for (const s of stars) if (s.tier === 'core') highlightIds.add(s.id)
  const starOrder = [...stars].sort((a, b) => {
    const tierOf = (s) => (s.tier === 'core' ? 3 : highlightIds.has(s.id) ? 2 : 1)
    const ta = a.invalidAt ? 0 : tierOf(a)
    const tb = b.invalidAt ? 0 : tierOf(b)
    return ta - tb || (a.id < b.id ? -1 : 1)
  })
  const edgeAllowed = (e) => (opt.edgeKinds || []).includes(e.kind)
  const edgeIndex = new Map()
  const idleEdges = !opt.edgeOn ? [] : opt.edgeMode === 'focus' ? []
    : (edges || []).filter(edgeAllowed).slice(0, opt.edgeMode === 'subtle' ? Math.min(opt.edgeMax, 40) : opt.edgeMax)
  for (const e of (edges || [])) {
    if (!edgeAllowed(e)) continue
    if (!edgeIndex.has(e.a)) edgeIndex.set(e.a, [])
    if (!edgeIndex.has(e.b)) edgeIndex.set(e.b, [])
    edgeIndex.get(e.a).push(e)
    edgeIndex.get(e.b).push(e)
  }
  const edgeFocusId = opt.selected || hover.current
  const edgeList = !opt.edgeOn ? [] : active ? (edges || []).filter((e) => edgeAllowed(e) && matchedIds.has(e.a) && matchedIds.has(e.b)) : edgeFocusId ? (edgeIndex.get(edgeFocusId) || []) : idleEdges
  const zoomGain = smClamp(view.zoom, 0.55, 3)
  const edgeWidth = smClamp(0.35 + 0.25 * zoomGain, 0.35, 1.1)
  const baseAlpha = active ? 0.2 : edgeFocusId ? 0.35 : 0.06 * (opt.edgeMode === 'subtle' ? 0.6 : 1)
  for (const e of edgeList) {
    // 选中/悬停时启用裁剪：连线的一端跑出画面，也要画到边缘，不能整条断掉。
    const a = edgeEndpoint(e.a, Boolean(edgeFocusId)), b = edgeEndpoint(e.b, Boolean(edgeFocusId))
    if (!a || !b) continue
    const alpha = smClamp(baseAlpha * zoomGain * (opt.edgeStrength || 1), 0, 0.65)
    if (alpha <= 0) continue
    ctx.strokeStyle = `rgba(${SM_EDGE_WHITE}, ${alpha})`
    ctx.lineWidth = edgeWidth
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // ── 半分辨率辉光层模拟 bloom ──
  if (opt.glow && typeof ctx.filter === 'string') {
    const gw = Math.max(160, Math.floor(W / 2))
    const gh = Math.max(170, Math.floor(H / 2))
    if (glowCanvas.width !== gw || glowCanvas.height !== gh) { glowCanvas.width = gw; glowCanvas.height = gh }
    const gc = glowCanvas.getContext('2d')
    gc.setTransform(1, 0, 0, 1, 0, 0)
    gc.clearRect(0, 0, gw, gh)
    gc.setTransform(0.5, 0, 0, 0.5, 0, 0)
    for (const s of stars) {
      if (s.invalidAt) continue
      const lit = highlightIds.has(s.id) || s.id === opt.selected || s.id === hover.current || (active && matchedIds.has(s.id))
      if (!lit) continue
      const p = proj.get(s.id)
      if (!p) continue
      if (p.x < -40 || p.x > W + 40 || p.y < -30 || p.y > H + 30) continue
      const b = smClamp(s.brightness, 0, 1)
      gc.globalAlpha = p.t * (0.22 + 0.55 * b)
      gc.fillStyle = colorOf(s)
      gc.beginPath()
      gc.arc(p.x, p.y, 2.4 + b * 1.6, 0, Math.PI * 2)
      gc.fill()
    }
    gc.globalAlpha = 0.7
    gc.fillStyle = '#ffd166'
    gc.beginPath()
    gc.arc(W / 2, H / 2, Math.max(10, Math.min(W, H) * 0.025), 0, Math.PI * 2)
    gc.fill()
    gc.globalAlpha = 1
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.85
    ctx.filter = 'blur(6px)'
    ctx.drawImage(glowCanvas, 0, 0, W, H)
    ctx.restore()
  }

  // ── 星团光环、层级射线、辐条、核心星 ──
  const font = '-apple-system, "Noto Sans SC", sans-serif'
  ctx.textAlign = 'center'
  const groupHits = []
  for (const group of layoutGroups) {
    const p = project(group)
    if (!p) continue
    if (p.x < -60 || p.x > W + 60 || p.y < -40 || p.y > H + 40) continue
    const fs = Math.round(smClamp(10 + p.t * 3, 10, 13))
    ctx.font = `${fs}px ${font}`
    const fading = group.id === 'fading'
    const archived = group.id === 'archived'
    const tint = fading ? '255, 190, 122' : archived ? '139, 147, 167' : (groupTints.get(group.id) || SM_GROUP_TINTS[0])
    const rr = (group.r || 0) * p.k
    const groupActive = opt.groupSelected === group.id || opt.hoverGroup === group.id
    ctx.globalAlpha = groupActive ? 0.2 + 0.12 * p.t : (archived ? 0.03 : 0.04 + 0.05 * p.t)
    ctx.strokeStyle = `rgba(${tint},1)`
    ctx.lineWidth = groupActive ? 1.3 : 1
    ctx.beginPath()
    ctx.moveTo(W / 2, H / 2)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    if (rr > 4) {
      ctx.globalAlpha = groupActive ? 0.26 + 0.24 * p.t : (fading ? 0.12 : archived ? 0.06 : 0.05) + 0.1 * p.t
      ctx.strokeStyle = groupActive ? '#ffd166' : fading ? '#ffbe7a' : archived ? '#8b93a7' : `rgb(${tint})`
      ctx.lineWidth = groupActive ? 1.8 : 1
      ctx.setLineDash(fading || archived ? [5, 5] : [])
      ctx.beginPath()
      ctx.arc(p.x, p.y, rr, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      if (!fading && !archived && rr > 12) {
        ctx.globalAlpha = (groupActive ? 0.22 : 0.06) * (0.5 + 0.5 * p.t)
        ctx.setLineDash([2, 5])
        ctx.beginPath()
        ctx.arc(p.x, p.y, rr * 1.12, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.globalAlpha = 1
    }
    const spokes = (clusterRanked.get(group.id) || []).filter((e) => proj.has(e.id)).slice(0, 5)
    for (const entry of spokes) {
      const spp = proj.get(entry.id)
      ctx.globalAlpha = (0.07 + 0.1 * p.t) * (groupActive ? 2 : 1)
      ctx.strokeStyle = `rgba(${tint},1)`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(spp.x, spp.y)
      ctx.stroke()
    }
    const coreR = smClamp((2.6 + Math.log10(Math.max(10, group.total)) * 1.05) * smClamp(p.k / 0.35, 0.9, 2.4), 2.6, 14)
    ctx.globalAlpha = (groupActive ? 0.2 : 0.08) * p.t
    ctx.fillStyle = `rgba(${tint},1)`
    ctx.beginPath()
    ctx.arc(p.x, p.y, coreR * 2.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 0.9 * p.t
    ctx.beginPath()
    ctx.arc(p.x, p.y, coreR, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 0.95 * p.t
    ctx.fillStyle = '#fff8e6'
    ctx.beginPath()
    ctx.arc(p.x, p.y, coreR * 0.42, 0, Math.PI * 2)
    ctx.fill()
    // 命中圈盖到虚线环（rr*1.12）之外一点，否则点星团边缘那圈虚线/子星云外延
    // 的空白会掉进「点空白」分支，把视角整个重置掉。
    groupHits.push({ id: group.id, x: p.x, y: p.y, r: Math.max(14, rr * 1.15), point: group })
  }

  // ── 星团标签：按团大小定优先级，避让带粘滞，避免旋转时一闪一闪 ──
  const labelGroups = [...layoutGroups].sort((a, b) => (b.total || 0) - (a.total || 0) || (a.id < b.id ? -1 : 1))
  for (const group of labelGroups) {
    const p = project(group)
    if (!p) continue
    if (p.x < -60 || p.x > W + 60 || p.y < -40 || p.y > H + 40) continue
    const fs = Math.round(smClamp(10 + p.t * 3, 10, 13))
    ctx.font = `${fs}px ${font}`
    const fading = group.id === 'fading'
    const archived = group.id === 'archived'
    const tint = fading ? '255, 190, 122' : archived ? '139, 147, 167' : (groupTints.get(group.id) || SM_GROUP_TINTS[0])
    const rr = (group.r || 0) * p.k
    const hot = matchedClusters.has(group.id) || opt.groupSelected === group.id || opt.hoverGroup === group.id
    const text = `${group.label} · ${group.total}`
    const lx = smClamp(p.x, 50, W - 50)
    const ly = smClamp(p.y - Math.max(14, rr * 0.62), 14, H - 8)
    const tw = ctx.measureText(text).width + 8
    const bh = fs + 3
    const boxTop = ly - fs + 2
    const collided = boxHit(lx, boxTop + bh / 2, tw, bh)
    if (collided && !hot) {
      const lastSeen = labelSeen.current.get(group.id) || 0
      if (now - lastSeen > 1200) continue
    }
    const fade = collided ? 0.55 : 1
    ctx.globalAlpha = fade
    ctx.fillStyle = `rgba(5, 10, 20, ${(0.35 + 0.3 * p.t) * fade})`
    ctx.fillRect(lx - tw / 2, boxTop, tw, bh)
    ctx.fillStyle = hot ? `rgba(255, 209, 102, ${(0.5 + 0.45 * p.t) * fade})`
      : fading ? `rgba(255, 190, 122, ${(0.3 + 0.6 * p.t) * fade})`
        : archived ? `rgba(139, 147, 167, ${(0.25 + 0.5 * p.t) * fade})`
          : `rgba(${tint}, ${(0.4 + 0.55 * p.t) * fade})`
    ctx.fillText(text, lx, ly)
    ctx.globalAlpha = 1
    labelBoxes.current.push({ x: lx, y: boxTop + bh / 2, w: tw, h: bh })
    labelSeen.current.set(group.id, now)
  }
  ctx.textAlign = 'center'
  ctx.globalAlpha = 1

  // ── 团内子星云 ──
  const childHits = []
  for (const group of layoutGroups) {
    const children = group.childClusters || []
    if (!children.length) continue
    if (opt.groupSelected && opt.groupSelected !== group.id && opt.hoverGroup !== group.id) continue
    const groupActive = opt.groupSelected === group.id || opt.hoverGroup === group.id
    const childFade = groupActive ? 1 : smClamp((view.zoom - 1.02) / 0.55, 0, 1)
    if (!groupActive && childFade <= 0.01) continue
    const groupP = project(group)
    const groupTint = groupTints.get(group.id) || SM_GROUP_TINTS[0]
    children.forEach((child, index) => {
      const point = { x: group.x + child.x, y: group.y + child.y, z: group.z + child.z }
      const p = project(point)
      if (!p) return
      if (p.x < -50 || p.x > W + 50 || p.y < -40 || p.y > H + 40) return
      const rr = Math.max(2, child.r * p.k)
      const tint = SM_CHILD_TINTS[index % SM_CHILD_TINTS.length]
      const chosen = opt.groupSelected === group.id && opt.groupChild === child.id
      if (groupActive && groupP) {
        ctx.globalAlpha = (chosen ? 0.42 : 0.2) * p.t
        ctx.strokeStyle = `rgba(${groupTint},1)`
        ctx.lineWidth = chosen ? 1.6 : 1.1
        ctx.beginPath()
        ctx.moveTo(groupP.x, groupP.y)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
      }
      ctx.globalAlpha = (groupActive ? 0.06 + 0.1 * p.t : 0.03) * childFade
      ctx.fillStyle = `rgba(${tint},1)`
      ctx.beginPath()
      ctx.arc(p.x, p.y, rr * 1.35, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = (chosen ? 0.55 : groupActive ? 0.24 : 0.12) * childFade
      ctx.strokeStyle = chosen ? '#ffd166' : `rgb(${tint})`
      ctx.lineWidth = chosen ? 1.8 : 1
      ctx.beginPath()
      ctx.arc(p.x, p.y, rr, 0, Math.PI * 2)
      ctx.stroke()
      const coreR = smClamp(rr * 0.22, 1.6, 7)
      ctx.globalAlpha = (chosen ? 0.28 : 0.12) * p.t * childFade
      ctx.fillStyle = `rgba(${tint},1)`
      ctx.beginPath()
      ctx.arc(p.x, p.y, coreR * 3.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 0.8 * p.t * childFade
      ctx.beginPath()
      ctx.arc(p.x, p.y, coreR, 0, Math.PI * 2)
      ctx.fill()
      if (groupActive) {
        const kids = (childRanked.get(child.id) || []).filter((e) => proj.has(e.id)).slice(0, 6)
        ctx.strokeStyle = `rgba(${tint},1)`
        ctx.lineWidth = 1
        for (const entry of kids) {
          const kp = proj.get(entry.id)
          ctx.globalAlpha = (chosen ? 0.26 : 0.12) * p.t
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(kp.x, kp.y)
          ctx.stroke()
        }
      }
      if (childFade > 0.15) childHits.push({ id: child.id, group: group.id, x: p.x, y: p.y, r: Math.max(14, rr), point })
      if (groupActive) {
        const text = `${child.label} · ${child.total}`
        ctx.globalAlpha = 1
        ctx.font = `${Math.round(smClamp(9 + p.t * 2, 9, 11))}px ${font}`
        const tw = ctx.measureText(text).width + 8
        const ly = smClamp(p.y - rr - 8, 12, H - 10)
        const boxTop = ly - 9
        if (!chosen && boxHit(p.x, boxTop + 6, tw, 14)) return
        ctx.fillStyle = 'rgba(5,10,20,0.66)'
        ctx.fillRect(p.x - tw / 2, boxTop, tw, 14)
        ctx.fillStyle = chosen ? 'rgba(255,209,102,0.95)' : `rgba(${tint},0.82)`
        ctx.fillText(text, p.x, ly)
        labelBoxes.current.push({ x: p.x, y: boxTop + 6, w: tw, h: 14 })
      }
    })
  }
  ctx.globalAlpha = 1
  ctx.textAlign = 'center'

  // ── 星点 ──
  const kBase = focal / (R * 3)
  const starLabelAlpha = smClamp((view.zoom - 1.75) / 0.55, 0, 1)
  const hits = []
  const labelCandidates = []
  const huge = stars.length > 6000 && view.zoom < 1.7
  const paintStar = (star, p, emphasized) => {
    const matched = active && matchedIds.has(star.id)
    const dim = active && !matched
    const isFocus = star.id === opt.selected || star.id === hover.current
    const b = smClamp(star.brightness, 0, 1)
    const hitLevel = smClamp(Math.log1p(Math.max(0, Number(star.hits) || 0)) / 4.2, 0, 1)
    const lit = highlightIds.has(star.id)
    const tier = star.tier === 'short' || star.tier === 'core' ? star.tier : 'long'
    const mag = Math.max(0.35, p.k / kBase)
    const baseR = 0.95 + 0.3 * b + 0.3 * hitLevel + (lit ? 0.55 : 0) + (tier === 'core' ? 0.3 : 0)
    const r = smClamp(baseR * Math.pow(mag, 0.46) * (0.55 + 0.45 * (p.td ?? p.t)), 0.9, 6.5)
    const depthFade = 0.72 + 0.28 * p.t
    const color = colorOf(star)
    if (dim) {
      ctx.globalAlpha = 0.1 * p.t
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(0.8, r * 0.8), 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      // 变暗但**仍然可点**：筛选只是视觉提示，不该让没被选中的星失联
      // （用户反馈「自己的经历点不开详细」就是被这行 return 挡掉的）
      hits.push({ id: star.id, x: p.x, y: p.y, r: Math.max(9, r + 5) })
      return
    }
    if (star.invalidAt) {
      // 已归档/已过时的星：老版本 alpha 0.5~0.85，这里原来 0.3 太淡，
      // 灰蓝虚线环 + 实心点几乎融进背景，用户反馈「已归档看不清」。
      const ar = Math.max(1.7, r)
      ctx.globalAlpha = smClamp(0.5 + 0.3 * p.t, 0, 0.85)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(p.x, p.y, ar, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = smClamp(0.3 + 0.3 * p.t, 0, 0.65)
      ctx.strokeStyle = 'rgba(190, 200, 218, 0.9)'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.arc(p.x, p.y, ar + 2.4, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      hits.push({ id: star.id, x: p.x, y: p.y, r: Math.max(10, r + 6) })
      return
    }
    if (huge && !lit && !isFocus && !matched) {
      ctx.globalAlpha = smClamp(p.t * 0.3, 0, 0.3)
      ctx.fillStyle = color
      ctx.fillRect(p.x, p.y, 1.2, 1.2)
      ctx.globalAlpha = 1
      return
    }
    if (lit || isFocus || matched) {
      ctx.globalAlpha = (0.04 + 0.09 * b) * p.t * depthFade
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
    const sizeAlpha = smClamp(r / 2.4, 0.62, 1)
    // 深度雾：用局部深度因子 td（1=近、0=远）做近亮远淡。之前用全局 p.t，聚焦后
    // 前后星星的 t 差异几乎为 0，分不清层次；td 按当前视野最近/最远重新归一化后，
    // 前后层在放大时也能看出深浅。下限从 0.3 降到 0.12，让远处真正雾化（近处仍亮）。
    const depthFog = smClamp(Math.pow(p.td ?? p.t, 1.4), 0, 1)
    const rawAlpha = depthFog * (0.35 + 0.45 * b) * depthFade * sizeAlpha
    ctx.globalAlpha = smClamp(rawAlpha, 0.12, 0.95)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fill()
    if (isFocus) {
      const len = r * 4 + 3
      ctx.globalAlpha = smClamp(0.3 * p.t, 0, 0.4)
      ctx.strokeStyle = '#ffd166'
      ctx.lineWidth = 0.9
      ctx.beginPath()
      ctx.moveTo(p.x - len, p.y)
      ctx.lineTo(p.x + len, p.y)
      ctx.moveTo(p.x, p.y - len)
      ctx.lineTo(p.x, p.y + len)
      ctx.stroke()
    }
    if (isFocus || matched) {
      ctx.globalAlpha = (emphasized ? 0.95 : 0.8) * p.t
      ctx.strokeStyle = '#ffd166'
      ctx.lineWidth = emphasized ? 1.6 : 1.1
      ctx.beginPath()
      ctx.arc(p.x, p.y, r + (emphasized ? 5 : 4), 0, Math.PI * 2)
      ctx.stroke()
    } else if (tier === 'core') {
      // 永久记忆：金色常亮环，不随清晰度变暗。
      ctx.globalAlpha = 0.42 * p.t
      ctx.strokeStyle = '#ffd166'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2)
      ctx.stroke()
    } else if (tier === 'short') {
      // 临时候选：虚线细环，提醒它随时可能被归档。
      ctx.globalAlpha = 0.32 * p.t
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.globalAlpha = 1
    // 所有星都注册命中区：原来 < 2.05 的不登记，导致暗淡的小星星（久远/低重要度的
    // 记忆，比如自己过去的经历）根本点不开详情。命中半径统一给到 9px 兜底。
    hits.push({ id: star.id, x: p.x, y: p.y, r: Math.max(9, r + 5) })
    if (!star.invalidAt && starLabelAlpha > 0 && b >= 0.3) {
      labelCandidates.push({ star, x: p.x, y: p.y, r, rank: rankOf(star) + (isFocus ? 5 : 0) })
    }
  }
  const deferred = []
  for (const star of starOrder) {
    const p = proj.get(star.id)
    if (!p) continue
    if (p.x < -40 || p.x > W + 40 || p.y < -30 || p.y > H + 30) continue
    if (star.id === opt.selected || star.id === hover.current || (active && matchedIds.has(star.id))) {
      deferred.push([star, p])
      continue
    }
    paintStar(star, p, false)
  }
  for (const [star, p] of deferred) paintStar(star, p, true)

  // ── 记忆中枢：太阳状核心，脉冲 + 十条光线 ──
  // 它固定画在画面正中心。聚焦某个星团时星团也被挪到正中心，
  // 两者会完全重叠——看起来就像「点星团结果聚焦到了记忆中枢」。
  // 所以选中星团时把中枢淡出。注意这里必须用 opt.groupSelected，
  // smDraw 是独立函数，没有组件里的 groupSel 变量。
  const hubFade = opt.groupSelected ? 0 : smClamp((view.camScale - 0.55) / 0.3, 0, 1)
  const pulse = opt.motion ? 1 + Math.sin(now * 0.0007) * 0.018 : 1
  const hubR = Math.max(7, Math.min(W, H) * 0.016) * pulse
  if (opt.motion && hubFade > 0) {
    for (let i = 0; i < 10; i += 1) {
      const angle = now * 0.00002 + i * Math.PI / 5
      const len = hubR * (2.6 + (i % 4) * 0.5)
      ctx.globalAlpha = 0.5 * hubFade
      ctx.strokeStyle = `rgba(255, 209, 102, ${0.05 + (i % 3) * 0.025})`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(W / 2 + Math.cos(angle) * hubR * 1.2, H / 2 + Math.sin(angle) * hubR * 1.2)
      ctx.lineTo(W / 2 + Math.cos(angle) * len, H / 2 + Math.sin(angle) * len)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 0.05 * hubFade
  ctx.fillStyle = '#ffd166'
  ctx.beginPath()
  ctx.arc(W / 2, H / 2, hubR * 4.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.12 * hubFade
  ctx.beginPath()
  ctx.arc(W / 2, H / 2, hubR * 2.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.55 * hubFade
  ctx.beginPath()
  ctx.arc(W / 2, H / 2, hubR * 1.45, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 0.95 * hubFade
  ctx.fillStyle = '#fff6d8'
  ctx.beginPath()
  ctx.arc(W / 2, H / 2, hubR, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = hubFade
  if (hubFade > 0.02) {
    ctx.fillStyle = 'rgba(255, 231, 163, 0.9)'
    ctx.font = `13px ${font}`
    ctx.fillText('记忆中枢', W / 2, H / 2 - hubR - 12)
    ctx.fillStyle = 'rgba(255, 231, 163, 0.45)'
    ctx.font = `11px ${font}`
    ctx.fillText(`${(stats && stats.total) || 0} 条记忆`, W / 2, H / 2 + hubR + 18)
  }

  // ── 放大后给清晰、重要的单星补标签 ──
  if (labelCandidates.length && starLabelAlpha > 0) {
    labelCandidates.sort((a, b) => b.rank - a.rank || (a.star.id < b.star.id ? -1 : 1))
    ctx.font = `11px ${font}`
    let shown = 0
    for (const item of labelCandidates) {
      if (shown >= 12) break
      const text = `${smShortText(item.star.aboutName || (item.star.tags && item.star.tags[0]) || '记忆', 10)} · ${Math.round(item.star.brightness * 100)}%`
      const width = ctx.measureText(text).width + 10
      const left = smClamp(item.x - width / 2, 6, W - width - 6)
      const top = smClamp(item.y + item.r + 6, 12, H - 21)
      if (boxHit(left + width / 2, top + 7, width, 15)) continue
      ctx.globalAlpha = starLabelAlpha
      ctx.fillStyle = 'rgba(5, 10, 20, 0.72)'
      ctx.fillRect(left, top, width, 15)
      ctx.fillStyle = item.star.id === opt.selected ? 'rgba(255, 209, 102, 0.95)' : 'rgba(198, 218, 244, 0.85)'
      ctx.textAlign = 'left'
      ctx.fillText(text, left + 5, top + 11)
      ctx.globalAlpha = 1
      labelBoxes.current.push({ x: left + width / 2, y: top + 7, w: width, h: 15 })
      shown += 1
    }
    ctx.textAlign = 'center'
  }

  const focus = hover.current || opt.selected
  const fp = focus ? proj.get(focus) : null
  const fs2: any = focus ? starsById.get(focus) : null
  if (fp && fs2) {
    ctx.font = `11px ${font}`
    const text = `${fs2.aboutName || '杂项'} · ${Math.round(fs2.brightness * 100)}%`
    const width = ctx.measureText(text).width + 12
    const left = smClamp(fp.x - width / 2, 6, W - width - 6)
    const top = fp.y > 32 ? fp.y - 26 : Math.min(H - 22, fp.y + 16)
    ctx.fillStyle = 'rgba(16, 24, 40, 0.92)'
    ctx.fillRect(left, top, width, 18)
    ctx.fillStyle = 'rgba(226, 236, 250, 0.9)'
    ctx.textAlign = 'left'
    ctx.fillText(text, left + 6, top + 13)
  }
  ctx.globalAlpha = 0.38
  ctx.fillStyle = '#9fb6d8'
  ctx.font = `11px ${font}`
  ctx.textAlign = 'left'
  ctx.fillText('拖拽旋转 · 滚轮缩放 · 点星/星团查看', 12, H - 12)
  ctx.fillText(
    opt.groupChild ? `子星云：${opt.groupChildLabel || ''}`
      : opt.tierFilter ? `只看${SM_TIER_LABEL[opt.tierFilter]}记忆 · ${matchedIds.size} 颗`
        : huge ? `大量记忆：${stars.length} 颗星，普通星点自动简化` : '全部星星常驻显示',
    12, H - 28,
  )
  ctx.textAlign = 'right'
  ctx.fillText(`×${view.zoom.toFixed(1)}`, W - 12, 18)
  ctx.fillText(`全部 ${stars.length} 颗`, W - 12, 34)
  ctx.globalAlpha = 1
  ctx.textAlign = 'center'
  return { hits, groupHits, childHits, project }
}

/** 星图开关/筛选存在本地，切页再回来不会重置。 */

function StarMap({ toast, onChanged }) {
  // 默认展开；收起状态存本地，切页回来不会又弹开。
  const [open, setOpen] = usePersisted('sm.open', true)
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState(null)
  const [groupSel, setGroupSel] = useState('')
  const [childSel, setChildSel] = useState('')
  // hover 只用来切鼠标样式（低频），悬停目标本体走 hoverRef / hoverGroupRef
  const [hover, setHover] = useState(null)
  // 面板开关（和原版一致）
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = usePersisted('sm.typeFilter', '')
  const [quickFilter, setQuickFilter] = usePersisted('sm.quickFilter', '')
  const [tierFilter, setTierFilter] = usePersisted('sm.tierFilter', '')
  // 这几项是「看图的偏好」，不该每次切页都重置回默认，存本地
  const [spin, setSpin] = usePersisted('sm.spin', true)
  const [glow, setGlow] = usePersisted('sm.glow', true)
  const [motion, setMotion] = usePersisted('sm.motion', true)
  const [edgeOn, setEdgeOn] = usePersisted('sm.edgeOn', true)
  const [edgeMode, setEdgeMode] = usePersisted('sm.edgeMode', 'subtle')
  const [edgeStrength, setEdgeStrength] = usePersisted('sm.edgeStrength', 0.3)
  const [edgeMax, setEdgeMax] = useState(60)
  const [edgeKinds, setEdgeKinds] = useState(['person', 'tag', 'similar', 'conflict', 'assoc'])
  const [detail, setDetail] = useState(null)
  // 编辑框（原版点「编辑」后出现，改文字和重要度）
  const [edit, setEdit] = useState(null)
  // 画布左上角的模块清单：**默认收起来**，不挡星星；点标题才展开。
  const [legendOpen, setLegendOpen] = usePersisted('sm.legendOpen', false)

  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const bgRef = useRef(null)
  const glowRef = useRef(null)
  const viewRef = useRef(null)
  const hitsRef = useRef([])
  const groupHitsRef = useRef([])
  // 绘制异常只记第一次，用来在面板上提示「星图画不出来是因为什么」
  const drawErrRef = useRef('')
  const [drawErr, setDrawErr] = useState('')
  const childHitsRef = useRef([])
  const hoverRef = useRef(null)
  // 鼠标移动时用这两个 ref 记当前悬停目标：渲染循环每帧读它们，
  // 只在「换了一颗星」时才 setState（只为切光标），避免每像素都重渲染。
  const localHoverRef = useRef(null)
  const hoverGroupRef = useRef('')
  const labelBoxesRef = useRef([])
  const labelSeenRef = useRef(new Map())
  const dragRef = useRef(null)

  const load = async () => {
    setBusy(true)
    try {
      const r = await get('/memory/graph')
      if (!r.ok) { toast(r.message || '星图加载失败', 'err'); return }
      setData(r)
    } catch (e) { toast('星图加载失败：' + e.message, 'err') } finally { setBusy(false) }
  }
  useEffect(() => { if (open && !data) load() }, [open])

  const post = async (path, body, okMsg) => {
    try {
      const r = await fetch('/aurabot/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((x) => x.json())
      toast(r.message || (r.ok ? (okMsg || '完成') : '失败'), r.ok ? 'ok' : 'err')
      if (r.ok) {
        // 不要先 setData(null)：那会让渲染 effect 以 data=null 白跑一次。
        // 直接重新拉一次，成功后用新数据替换，顺便把侧栏详情同步到最新状态。
        const fresh = await get('/memory/graph').catch(() => null)
        if (fresh && fresh.ok) {
          setData(fresh)
          setDetail((cur) => (cur ? (fresh.stars || []).find((s) => s.id === cur.id) || null : null))
        }
        onChanged?.()
      }
      return r
    } catch (e) { toast('操作失败：' + e.message, 'err'); return { ok: false } }
  }

  // ── 渲染循环 ──
  useEffect(() => {
    if (!open || !data) return
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    if (!viewRef.current) {
      // zoom 的初值必须和 targetZoom 一致，否则第一帧从 1.7 一路缩到 1.2，
      // 眼睛会看到画面「突然动了一下」——这就是每次进页面都觉得突兀的原因。
      viewRef.current = {
        yaw: 0.45, pitch: 0.32, zoom: 1.2, targetZoom: 1.2,
        cam: { x: 0, y: 0, z: 0 }, camTarget: { x: 0, y: 0, z: 0 }, camScale: 1, camScaleTarget: 1,
        focusId: null, fYaw: 0.45, fPitch: 0.32, vYaw: 0, vPitch: 0, dragging: false,
      }
    }
    const view = viewRef.current
    const bgCanvas = bgRef.current || (bgRef.current = document.createElement('canvas'))
    const glowCanvas = glowRef.current || (glowRef.current = document.createElement('canvas'))
    // 子星云名字只在选中变化时算一次；放进 tick 里会变成每帧一次全量扫描（60fps 白烧 CPU）。
    const childLabel = (() => {
      if (!childSel) return ''
      for (const g of (data.layout?.groups || [])) {
        const hit = (g.childClusters || []).find((c) => c.id === childSel)
        if (hit) return hit.label
      }
      return ''
    })()
    let raf = 0
    let last = performance.now()
    const tick = (time) => {
      const dt = Math.min(0.05, (time - last) / 1000)
      last = time
      if (!view.dragging) {
        if (view.focusId) {
          const dy = ((view.fYaw - view.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
          view.yaw += dy * Math.min(1, dt * 4.5)
          view.pitch += (view.fPitch - view.pitch) * Math.min(1, dt * 4.5)
          view.vYaw = 0
          view.vPitch = 0
          // 到达目标角度就解除锁定，否则视角会一直被拽回默认、拖不动
          if (Math.abs(dy) < 0.005 && Math.abs(view.fPitch - view.pitch) < 0.005) view.focusId = null
        } else {
          view.yaw += view.vYaw * dt * 60
          view.pitch = smClamp(view.pitch + view.vPitch * dt * 60, -1.25, 1.25)
          const decay = Math.pow(0.9, dt * 60)
          view.vYaw *= decay
          view.vPitch *= decay
          if (spin && !sel && !groupSel) view.yaw += dt * 0.05
        }
      }
      view.zoom += (view.targetZoom - view.zoom) * Math.min(1, dt * 9)
      const camLerp = Math.min(1, dt * 3.6)
      // 安全阀：防止镜头被挪到星图外面（只兜住离谱值，不限制正常聚焦）。
      // 旧版聚焦是「完整移到目标坐标」，所以上限放到 1.1 倍半径；
      // camScale 下限同步放宽到 0.2（旧版 focusOn 用 0.5、focusPoint 用 0.45）。
      const Rlim = (data.layout && data.layout.radius) || 470
      const camLim = Rlim * 1.1
      view.camTarget.x = smClamp(view.camTarget.x, -camLim, camLim)
      view.camTarget.y = smClamp(view.camTarget.y, -camLim, camLim)
      view.camTarget.z = smClamp(view.camTarget.z, -camLim, camLim)
      view.camScaleTarget = smClamp(view.camScaleTarget, 0.2, 3)
      view.cam.x += (view.camTarget.x - view.cam.x) * camLerp
      view.cam.y += (view.camTarget.y - view.cam.y) * camLerp
      view.cam.z += (view.camTarget.z - view.cam.z) * camLerp
      view.camScale += (view.camScaleTarget - view.camScale) * camLerp
      const W = Math.max(320, Math.round(wrap.clientWidth))
      const H = Math.max(340, Math.round(W * 0.62))
      const dpr = window.devicePixelRatio || 1
      const pw = Math.floor(W * dpr), ph = Math.floor(H * dpr)
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph }
      canvas.style.width = W + 'px'
      canvas.style.height = H + 'px'
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      labelBoxesRef.current = []
      // 兜底：smDraw 里任何一处抛异常都会让 requestAnimationFrame 链断掉，
      // 画布从此一片空白（连星星都没有）。捕获后把画面清成空、继续下一帧，
      // 至少不会整块卡死；错误只记一次，免得每帧刷屏。
      try {
        const out = smDraw(ctx, {
          W, H, stars: data.stars || [], layout: data.layout, stats: data.stats, edges: data.edges,
          view, bgCanvas, glowCanvas,
          hover: hoverRef, labelBoxes: labelBoxesRef, labelSeen: labelSeenRef, now: time,
          opt: { query, typeFilter, quickFilter, tierFilter, spin, glow, motion, edgeOn, edgeMode, edgeStrength, edgeMax, edgeKinds, selected: sel, groupSelected: groupSel, groupChild: childSel, groupChildLabel: childLabel, hoverGroup: hoverGroupRef.current },
        })
        hitsRef.current = out.hits
        groupHitsRef.current = out.groupHits
        childHitsRef.current = out.childHits
        drawErrRef.current = ''
      } catch (e) {
        if (!drawErrRef.current) {
          drawErrRef.current = e && e.message ? e.message : String(e)
          setDrawErr(drawErrRef.current)
          console.error('[星图] 绘制失败：', e)
        }
        hitsRef.current = []
        groupHitsRef.current = []
        childHitsRef.current = []
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, data, sel, groupSel, childSel, spin, glow, motion, query, typeFilter, quickFilter, tierFilter, edgeOn, edgeMode, edgeStrength, edgeMax, edgeKinds])

  // 滚轮缩放（passive: false 才能 preventDefault）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event) => {
      event.preventDefault()
      const view = viewRef.current
      if (!view) return
      view.targetZoom = smClamp(view.targetZoom * Math.exp(-event.deltaY * 0.0015), 0.55, 15)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [open, data])

  // ── 鼠标交互 ──
  const pick = (x, y) => {
    let best = null, bestD = Infinity
    for (const hit of hitsRef.current) {
      const d = Math.hypot(hit.x - x, hit.y - y)
      if (d <= hit.r && d < bestD) { bestD = d; best = hit }
    }
    return best
  }
  const pickGroup = (x, y) => {
    let best = null, bestD = Infinity
    for (const hit of groupHitsRef.current) {
      const d = Math.hypot(hit.x - x, hit.y - y)
      if (d <= hit.r && d < bestD) { bestD = d; best = hit }
    }
    return best
  }
  const pickChild = (x, y) => {
    let best = null, bestD = Infinity
    for (const hit of childHitsRef.current) {
      const d = Math.hypot(hit.x - x, hit.y - y)
      if (d <= hit.r && d < bestD) { bestD = d; best = hit }
    }
    return best
  }
  const onDown = (e) => {
    // 只有左键才开始拖拽。右键会触发 contextmenu，如果这里也记起点，
    // 右键那一下会被当成一次拖拽，视角直接被甩走（截图里星点飞了的真因）。
    if (e.button !== 0) return
    dragRef.current = { x: e.clientX, y: e.clientY, yaw: viewRef.current?.yaw || 0.45, pitch: viewRef.current?.pitch || 0.32 }
    if (viewRef.current) {
      viewRef.current.dragging = true
      // 拖拽立即打断「返回动画」的视角锁定，否则镜头会被拽回默认角度
      viewRef.current.focusId = null
    }
  }
  const onMove = (e) => {
    const d = dragRef.current
    const canvas = canvasRef.current
    if (!canvas || !viewRef.current) return
    if (!d) {
      // 悬停检测。只写 ref，不 setState —— 渲染循环每帧都读 hoverRef，
      // 每移动一次鼠标就 setState 会把 React 拖垮（原版也是只用 ref）。
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const s = pick(mx, my)
      const g = pickGroup(mx, my)
      const nextId = s ? s.id : null
      if (localHoverRef.current !== nextId) {
        localHoverRef.current = nextId
        hoverRef.current = nextId
        // 只为了让光标样式变一下，这个变化频率低，setState 可以接受
        setHover(nextId)
      }
      hoverGroupRef.current = g ? g.id : ''
      return
    }
    // 右键/中键拖拽不动视角（也防住按住右键移动时把镜头甩飞）
    if (e.buttons && (e.buttons & 1) === 0) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    viewRef.current.yaw = d.yaw + dx * 0.007
    viewRef.current.pitch = smClamp(d.pitch + dy * 0.007, -1.25, 1.25)
    viewRef.current.vYaw = dx * 0.0006
    viewRef.current.vPitch = dy * 0.0006
  }
  const onUp = (e) => {
    const d = dragRef.current
    dragRef.current = null
    if (viewRef.current) viewRef.current.dragging = false
    if (!d) return
    // 位移阈值对齐旧版（12px）：手在「按下→抬起」间难免微动，3px 太严，
    // 几乎每次点击都被当成拖拽丢掉，点星团/星星自然「没反应」。
    const moved = Math.abs(e.clientX - d.x) > 12 || Math.abs(e.clientY - d.y) > 12
    if (moved) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    const child = pickChild(mx, my)
    const zoomNow = viewRef.current?.zoom || 1
    // 星星可点条件对齐旧版 panel.js：放大到 1.75 以上，或已经钻进某个星团/子星云。
    // 光有 zoom 门槛不够——点星团聚焦后 zoom 只到 1.7（< 1.8），此时想点团内星星会落空。
    const star = (zoomNow >= 1.75 || groupSel || childSel) ? pick(mx, my) : null
    const groupHit = pickGroup(mx, my)
    // 点击点是否落在「当前聚焦子星云」的命中圈内。点错星星时落点可能同时擦到
    // 兄弟子星云（pickChild 会返回更近的那个）；只要还在当前子星云命中圈内，
    // 就属于「子星云内空白/点错」，必须不动——这是最高优先级规则。
    const inCurrentChild = Boolean(childSel) && childHitsRef.current.some((h) => (
      h.id === childSel && Math.hypot(h.x - mx, h.y - my) <= h.r
    ))
    // 退回「只聚焦父团」：清子星云聚焦，镜头回到父团，缩放回团级。供两处复用。
    // 保留 sel/detail：选中星星的**连接线**要留着——子星团之间的星星常有边，
    // 转移时清掉选中会让人看不到这些连接（用户明确要求）。
    const backToParent = () => {
      setChildSel(''); setEdit(null)
      const pg = (data.layout?.groups || []).find((x) => String(x.id) === groupSel)
      if (pg && viewRef.current) {
        viewRef.current.focusId = null
        viewRef.current.camTarget = { x: Number(pg.x) || 0, y: Number(pg.y) || 0, z: Number(pg.z) || 0 }
        viewRef.current.camScaleTarget = 0.5
        viewRef.current.targetZoom = 1.7
      }
    }
    // 星星优先（点星星要看具体记忆），其次子星云，最后星团——对齐旧版 pick 顺序
    // star → child → group。星星常会挤在子星云的命中圈内，若让子星云先命中，
    // 点星星永远被抢走、看不了详情。
    // 「点歪了不该动」的基准是「当前聚焦的子星云」（不是父团）：
    // 点在当前子星云内 → 不动；点在子星云外 → 该切换切换、该退回退回。

    if (star) {
      // 不清 groupSel、也不清 childSel：点星星只是「顺便看一眼详情」，不改变
      // 所在层级（点前在子星云里，点完还在子星云里）。清了会解除「只显示选中
      // 星团/子星云」的过滤，所有星团重新出现，视觉上像视角被重置。
      setSel(star.id)
      const full = (data.stars || []).find((s) => s.id === star.id)
      if (!full) toast('这条记忆已不在星图里', 'err')
      setDetail(full || null)
      // 换了一颗星才清编辑框；点同一颗星保留，免得打断正在编辑的内容
      if (star.id !== sel) setEdit(null)
      // 点星星**不动镜头**：镜头一挪，当前星团就被甩出画面，看起来像「视角被重置」。
      if (viewRef.current) viewRef.current.focusId = null
      return
    }
    if (child) {
      // 点中的子星云 = 当前聚焦的子星云，或点击点仍落在当前子星云命中圈内 →
      // 都属于「子星云内空白/点错」，不动（最高优先级，点歪了不能被移走视角）。
      if (child.id === childSel || inCurrentChild) return
      // 点中「别的子星云」（同团兄弟或跨团）：有意点击，转移聚焦过去。
      // 保留 sel/detail：选中星星的**连接线**要留着——子星团之间的星星常有边，
      // 转移时清掉选中会让人看不到这些连接（用户明确要求）。只清编辑框。
      setGroupSel(child.group); setChildSel(child.id); setEdit(null)
      // 和旧版 focusPoint 一致：点开子星云时镜头跟到它的绝对坐标。
      // child.point 已经是「团坐标 + 子星云偏移」的绝对坐标，直接作镜头目标。
      // camScale 0.26 / zoom 2.6 对齐旧版 focusPoint(child, 2.6, 0.26)：
      // 比默认更近，让挤成一团的子星云尽量摊开、星星可分辨。
      const cp = child.point
      if (cp && viewRef.current) {
        viewRef.current.focusId = null
        viewRef.current.camTarget = {
          x: Number(cp.x) || 0,
          y: Number(cp.y) || 0,
          z: Number(cp.z) || 0,
        }
        viewRef.current.camScaleTarget = 0.26
        viewRef.current.targetZoom = 2.6
      }
      return
    }
    // 星团：走到这里说明这一下既没点中星星、也没点中子星云。
    if (groupHit) {
      // 最高优先级：点击点仍在「当前聚焦子星云」命中圈内 → 子星云内空白，不动。
      // （点错星星时可能同时命中父团/别的团，但都不能移动视角。）
      if (inCurrentChild) return
      // 关键：pickGroup 只返回「最近的那个团」，点在大团内部时可能同时压着别的团、
      // 且别的团圆心更近 → 会误判成「点别的团」。所以这里不认 pickGroup 的结果，
      // 单独判断「点击点是否落在当前聚焦星团的圆盘内」。
      const curGroupHit = groupSel ? groupHitsRef.current.find((h) => h.id === groupSel) : null
      const curDiskR = curGroupHit ? (Number(curGroupHit.rr) || Number(curGroupHit.r) || 0) : 0
      const inCurrentGroupDisk = Boolean(curGroupHit) && Math.hypot(curGroupHit.x - mx, curGroupHit.y - my) <= curDiskR

      // 点在「当前聚焦星团」的圆盘内 = 团内：
      //  · 聚焦子星云时 → 这是「子星云外的父团空白」，退回父团
      //  · 只聚焦星团时 → 这是「团内空白」（当前层级内容），不动
      // 这样点在大团内部、即使那里同时压着别的大团，也不会被切走。
      if (inCurrentGroupDisk) {
        if (childSel) backToParent()
        return
      }
      const groupId = String(groupHit.id || '')
      if (groupId === groupSel) return
      // 点中「别的星团」且确实在当前团圆盘外：有意点击目标，正常切过去。
      // 同样保留 sel/detail（连接线），只清编辑框。
      setGroupSel(groupId); setChildSel(''); setEdit(null)
      const g = (data.layout?.groups || []).find((x) => String(x.id) === groupId)
      if (g && viewRef.current) {
        // camScale 0.5：比默认视角近、但仍在「中枢显形阈值 0.55」之下。
        const cx = Number(g.x) || 0, cy = Number(g.y) || 0, cz = Number(g.z) || 0
        viewRef.current.focusId = null
        viewRef.current.camTarget = { x: cx, y: cy, z: cz }
        viewRef.current.camScaleTarget = 0.5
        viewRef.current.targetZoom = 1.7
      }
      return
    }
    // 点空白（没点中星星/子星云/星团）：点在「当前聚焦星团外」，逐级退回。
    //  · 聚焦子星云 → 退回聚焦父团
    //  · 聚焦星团   → 退回全景
    //  · 全景       → 不动
    // 退回时同样保留 sel/detail（连接线）：选中星星的边关系在退回全景后
    // 依然要能看到；要取消选中，点详情卡的「×」或换选另一颗星即可。
    if (childSel) { backToParent(); return }
    if (groupSel) { setGroupSel(''); setChildSel(''); setEdit(null); resetView() }
    return
  }


  const resetView = () => {
    if (!viewRef.current) return
    const v = viewRef.current
    // 返回动画：zoom / cam / camScale 只设「目标值」，渲染循环会用 lerp 平滑逼近；
    // 不再直接赋值 zoom/cam/camScale，否则整片星空瞬间跳回默认（闪回）。
    // yaw/pitch 借 focusId 机制（fYaw/fPitch 是目标角度）平滑转回默认。
    v.focusId = '__home__'
    v.fYaw = 0.45
    v.fPitch = 0.32
    v.targetZoom = 1.2
    v.vYaw = 0
    v.vPitch = 0
    v.camTarget = { x: 0, y: 0, z: 0 }
    v.camScaleTarget = 1
  }

  const stars = data?.stars || []
  const groups = data?.layout?.groups || []
  const TIER_LABEL = SM_TIER_LABEL
  const TYPE_OPTS = [{ v: '', t: '全部区域' }, { v: 'person', t: '人物' }, { v: 'event', t: '经历' }, { v: 'knowledge', t: '知识' }, { v: 'core', t: '核心' }, { v: 'outdated', t: '已过时' }, { v: 'archived', t: '已归档' }]
  const stats = data?.stats || (stars.length ? {
    total: stars.length,
    live: stars.filter((s) => !s.archivedAt && !s.invalidAt).length,
    archived: stars.filter((s) => s.archivedAt).length,
    bright: stars.filter((s) => (s.brightness || 0) >= 0.7).length,
    dim: stars.filter((s) => (s.brightness || 0) < 0.35).length,
  } : null)

  return h(Card, {
    title: '记忆星图',
    desc: '把记忆画成星空：越亮记得越牢，位置按人物/经历/知识/核心分区。点星星能复习、改层级、编辑或删除。',
    right: h('div', { className: 'ab-flex', style: { gap: 8 } },
      h(Btn, { small: true, onClick: () => { setOpen(!open); if (!open && !data) load() } }, open ? '收起' : '展开'),
      open ? h(Btn, { small: true, onClick: () => post('/memory/graph/optimize', {}, '已优化') }, '重新布局') : null,
      open ? h(Btn, { small: true, onClick: load }, busy ? '刷新中…' : '刷新') : null),
  }, !open ? null : [
    h('div', { key: 'stats', className: 'ab-note' }, stats
      ? `共 ${stats.total} 颗星：存活 ${stats.live}、归档 ${stats.archived}、清晰 ${stats.bright}、快忘了 ${stats.dim}`
      : (busy ? '正在读取星图…' : '还没有记忆，星图是空的')),

    // 搜索与筛选：搜索框吃掉剩余宽度，三个下拉固定宽度不抢位，右侧跟一个「重置」
    h('div', { key: 'ctrl', style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0' } },
      h('input', { className: 'ab-input sm', style: { flex: '1 1 160px', minWidth: 130 }, placeholder: '搜星星：内容 / 人名 / 标签', value: query, onChange: (e) => setQuery(e.target.value) }),
      h('select', { className: 'ab-input sm', style: { flex: '0 0 auto', width: 96 }, value: typeFilter, onChange: (e) => setTypeFilter(e.target.value) }, TYPE_OPTS.map((o) => h('option', { key: o.v, value: o.v }, o.t))),
      h('select', { className: 'ab-input sm', style: { flex: '0 0 auto', width: 96 }, value: tierFilter, onChange: (e) => setTierFilter(e.target.value) },
        [{ v: '', t: '全部层级' }, { v: 'short', t: '临时' }, { v: 'long', t: '长期' }, { v: 'core', t: '永久' }].map((o) => h('option', { key: o.v, value: o.v }, o.t))),
      h('select', { className: 'ab-input sm', style: { flex: '0 0 auto', width: 104 }, value: quickFilter, onChange: (e) => setQuickFilter(e.target.value) },
        [{ v: '', t: '不筛选' }, { v: 'dim', t: '只看快忘了' }, { v: 'recent', t: '只看最近 7 天' }].map((o) => h('option', { key: o.v, value: o.v }, o.t))),
      h(Btn, { small: true, onClick: resetView }, '重置视角')),

    // 显示开关（缩成一行小字，不抢画布）
    h('div', { key: 'opts', className: 'ab-flex', style: { gap: 10, flexWrap: 'wrap', marginBottom: 8, fontSize: 12, opacity: 0.85 } },
      [['自动旋转', spin, setSpin], ['辉光', glow, setGlow], ['动态星尘', motion, setMotion], ['关系线', edgeOn, setEdgeOn]].map(([label, val, set]) =>
        h('label', { key: label, style: { display: 'flex', gap: 3, alignItems: 'center', cursor: 'pointer' } },
          h('input', { type: 'checkbox', checked: val, onChange: (e) => set(e.target.checked) }), label)),
      edgeOn ? h('select', { className: 'ab-input sm', value: edgeMode, onChange: (e) => setEdgeMode(e.target.value) },
        [{ v: 'focus', t: '只在选中时' }, { v: 'subtle', t: '微光' }, { v: 'normal', t: '标准' }].map((o) => h('option', { key: o.v, value: o.v }, o.t))) : null,
      edgeOn && edgeMode !== 'focus' ? h('label', { style: { display: 'flex', gap: 3, alignItems: 'center' } }, '强度',
        h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: edgeStrength, onChange: (e) => setEdgeStrength(Number(e.target.value)), style: { width: 56 } })) : null),

    // 画布
    h('div', { key: 'canvas', ref: wrapRef, style: { position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(120,160,220,0.25)', background: '#0a1120', minHeight: 360 } },
      // 数据没到时铺一层「正在读记忆库」，画布淡入时它是淡出的，
      // 页面不会从「一小块空白」突然长成「满屏星空」。
      !data ? h('div', {
        key: 'ph',
        style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(178,204,240,0.6)', fontSize: 13, letterSpacing: 1 },
      }, busy ? '正在读记忆库…' : '星图待加载') : null,
      h('canvas', { ref: bgRef, style: { display: 'none' } }),
      h('canvas', { ref: glowRef, style: { display: 'none' } }),
      h('canvas', {
        ref: canvasRef,
        // 淡入：数据到位前是空的，直接「啪」一下出现满屏星星很突兀，
        // 用 220ms 透明度过渡把它变成一次平稳的显现。
        style: { display: 'block', cursor: dragRef.current ? 'grabbing' : (hover ? 'pointer' : 'grab'), touchAction: 'none', opacity: data ? 1 : 0, transition: 'opacity .22s ease-out' },
        onMouseDown: onDown, onMouseMove: onMove, onMouseUp: onUp,
        onMouseLeave: () => {
          dragRef.current = null
          if (viewRef.current) viewRef.current.dragging = false
          hoverRef.current = null
          localHoverRef.current = null
          hoverGroupRef.current = ''
          setHover(null)
        },
      }),
      // 左上角清单：**默认只显示一行标题**，点开才铺开层级+星团。
      // 收起时宽度自适应（只有「清单 · 星团 11 ＋」这么点），几乎不挡星星。
      h('div', {
        key: 'legend',
        className: 'ab-thin-scroll',
        style: {
          position: 'absolute', left: 10, top: 10,
          width: legendOpen ? 160 : 'auto', maxWidth: 'calc(100% - 20px)',
          maxHeight: 'calc(100% - 20px)', overflowY: 'auto', overflowX: 'hidden', zIndex: 3,
          padding: legendOpen ? '3px 8px 3px 4px' : '3px 9px 3px 6px', borderRadius: 8,
          background: 'rgba(6, 11, 22, 0.6)',
          border: '1px solid rgba(120, 160, 220, 0.2)',
          scrollbarWidth: legendOpen ? 'thin' : 'none',
          scrollbarGutter: legendOpen ? 'stable' : 'auto',
        },
      },
        h('div', {
          onClick: () => setLegendOpen((x) => !x),
          title: legendOpen ? '收起清单' : '展开清单（层级筛选 + 星团列表）',
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '2px 4px 4px', cursor: 'pointer' },
        },
          h('span', { style: { fontSize: 10, letterSpacing: 1, color: 'rgba(178, 204, 240, 0.7)' } }, legendOpen ? '层级' : '清单'),
          // 收起时把星团数量写在标题上，不展开也知道规模
          !legendOpen ? h('span', { style: { fontSize: 10, color: 'rgba(178, 204, 240, 0.55)' } }, '星团 ' + groups.length) : null,
          h('span', { style: { fontSize: 10, color: 'rgba(178, 204, 240, 0.6)', flex: '0 0 auto' } }, legendOpen ? '－' : '＋')),

        // 层级筛选：点一下只看这一档，再点取消
        !legendOpen ? null : h('div', { style: { padding: '0 0 6px', marginBottom: 4, borderBottom: '1px solid rgba(120, 160, 220, 0.18)' } },
          [['core', '永久', '255, 209, 102'], ['long', '长期', '143, 197, 255'], ['short', '临时', '159, 182, 216']].map(([t, label, tint]) => {
            const active = tierFilter === t
            return h('div', {
              key: t,
              onClick: () => setTierFilter(active ? '' : t),
              title: active ? '再点一次查看全部层级' : '只看' + label + '记忆',
              style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 5px', borderRadius: 5, cursor: 'pointer', background: active ? 'rgba(255, 209, 102, 0.12)' : 'transparent' },
            },
              h('span', { style: { width: 7, height: 7, flex: '0 0 auto', borderRadius: '50%', background: `rgb(${tint})`, boxShadow: `0 0 6px rgba(${tint}, 0.7)` } }),
              h('span', { style: { flex: '1 1 auto', fontSize: 11, color: active ? '#ffd166' : 'rgba(226, 236, 255, 0.86)' } }, label),
              h('span', { style: { fontSize: 10, color: 'rgba(178, 204, 240, 0.55)' } }, String(stars.filter((s) => s.tier === t).length)) )
          })),

        // 模块（星团）列表：跟层级一起受清单开关控制（收起时整块只剩标题一行）
        !legendOpen ? null : groups.map((g) => {
          const tint = g.id === 'archive' ? '139, 147, 167' : (SM_GROUP_TINTS[smTintIndexOf(g.id)] || SM_GROUP_TINTS[0])
          const active = groupSel === g.id
          const children = g.childClusters || []
          return h('div', { key: g.id },
            h('div', {
              onClick: () => setGroupSel(active ? '' : g.id),
              style: { display: 'flex', alignItems: 'center', gap: 6, padding: '3px 5px', borderRadius: 5, cursor: 'pointer', background: active ? 'rgba(255, 209, 102, 0.12)' : 'transparent' },
            },
              h('span', { style: { width: 7, height: 7, flex: '0 0 auto', borderRadius: '50%', background: `rgb(${tint})`, boxShadow: `0 0 6px rgba(${tint}, 0.7)` } }),
              h('span', { style: { flex: '1 1 auto', minWidth: 0, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: active ? '#ffd166' : 'rgba(226, 236, 255, 0.86)' } }, smShortText(g.label, 8)),
              h('span', { style: { fontSize: 10, color: 'rgba(178, 204, 240, 0.55)' } }, g.total)),
            active ? children.map((c, i) => {
              const childTint = SM_CHILD_TINTS[i % SM_CHILD_TINTS.length]
              return h('div', {
                key: c.id,
                onClick: (ev) => { ev.stopPropagation(); setGroupSel(g.id); setChildSel(c.id) },
                style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 5px 2px 18px', borderRadius: 5, cursor: 'pointer', background: childSel === c.id ? 'rgba(255, 209, 102, 0.1)' : 'transparent' },
              },
                h('span', { style: { width: 5, height: 5, flex: '0 0 auto', borderRadius: '50%', background: `rgb(${childTint})`, boxShadow: `0 0 5px rgba(${childTint}, 0.7)` } }),
                h('span', { style: { flex: '1 1 auto', minWidth: 0, fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: childSel === c.id ? '#ffd166' : 'rgba(214, 226, 245, 0.78)' } }, smShortText(c.label, 9)),
                h('span', { style: { fontSize: 9, color: 'rgba(178, 204, 240, 0.5)' } }, c.total))
            }) : null)
        }),
      ),
      // 选中的星详情：绝对定位在星图右上角（和左上角清单对称），不占页面流
      detail ? h('div', {
        key: 'detail',
        className: 'ab-card ab-thin-scroll',
        style: {
          position: 'absolute', right: 10, top: 10,
          width: 'min(240px, calc(100% - 20px))', maxHeight: 'calc(100% - 20px)',
          overflowY: 'auto', overflowX: 'hidden', zIndex: 4, margin: 0,
          padding: '10px 12px', borderRadius: 8,
          background: 'rgba(6, 11, 22, 0.88)',
          border: '1px solid rgba(120, 160, 220, 0.28)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)',
        },
      },
        h('div', { className: 'ab-flex', style: { justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 } },
          h('strong', { style: { fontSize: 12, lineHeight: 1.5 } }, detail.text),
          h('span', {
            onClick: () => { setDetail(null); setSel(null); setEdit(null) },
            title: '关闭',
            style: { flex: '0 0 auto', cursor: 'pointer', color: 'rgba(178,204,240,0.6)', fontSize: 14, lineHeight: 1 },
          }, '×')),
        h('div', { className: 'ab-muted ab-small', style: { margin: '6px 0' } },
          `层级 ${TIER_LABEL[detail.tier] || '长期'} · 清晰度 ${Math.round((detail.brightness || 0) * 100)}% · 重要度 ${Math.round((detail.importance || 0) * 100)}%` +
          (detail.aboutName ? ` · 关于 ${detail.aboutName}` : '') +
          (detail.cluster ? ` · 星团 ${detail.cluster}` : '')),
        h('div', { className: 'ab-flex', style: { gap: 6, flexWrap: 'wrap', marginTop: 6 } },
          h(Btn, { small: true, onClick: () => post('/memory/graph/review', { id: detail.id }, '已复习') }, '还记得'),
          h(Btn, { small: true, onClick: () => post('/memory/graph/tier', { id: detail.id, tier: 'short' }, '已改为临时') }, '临时'),
          h(Btn, { small: true, onClick: () => post('/memory/graph/tier', { id: detail.id, tier: 'long' }, '已改为长期') }, '长期'),
          h(Btn, { small: true, onClick: () => post('/memory/graph/tier', { id: detail.id, tier: 'core' }, '已改为永久') }, '永久'),
          detail.archivedAt || detail.invalidAt ? h(Btn, { small: true, onClick: () => post('/memory/graph/restore', { id: detail.id }, '已恢复') }, '恢复') : null,
          h(Btn, { small: true, onClick: () => setEdit({ text: detail.text, importance: detail.importance ?? 0.5 }) }, '编辑'),
          h(Btn, { small: true, kind: 'danger', onClick: () => post('/memory/graph/remove', { id: detail.id }, '已删除') }, '删除')),
        edit ? h('div', { style: { marginTop: 8 } },
          h('div', { className: 'ab-flex', style: { gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
            h('input', { className: 'ab-input', style: { flex: '1 1 140px', fontSize: 11 }, value: edit.text, onChange: (e) => setEdit({ ...edit, text: e.target.value }) }),
            h('input', { className: 'ab-input sm', type: 'number', min: 0, max: 1, step: 0.05, style: { width: 64 }, value: edit.importance, onChange: (e) => setEdit({ ...edit, importance: Number(e.target.value) || 0 }) }),
            h(Btn, { small: true, onClick: async () => {
              if (!edit.text.trim()) { toast('内容不能为空', 'err'); return }
              const r = await post('/memory/graph/update', { id: detail.id, patch: { text: edit.text.trim(), importance: edit.importance } }, '已修改')
              if (r.ok) setEdit(null)
            } }, '保存'),
            h(Btn, { small: true, onClick: () => setEdit(null) }, '取消'))) : null) : null,
    ),
    busy ? h('div', { key: 'busy', className: 'ab-muted ab-small', style: { marginTop: 6 } }, '正在计算星图布局…') : null,
    // 绘制异常时把原因直接显示出来，别再让用户对着空画布猜
    drawErr ? h('div', { key: 'drawnote', className: 'ab-note err', style: { marginTop: 8 } }, '星图绘制失败：' + drawErr + '（下面的星星列表仍可用）') : null,

    // 新增（清单已经收进画布左上角，这里不再重复列一遍）
    h('div', { key: 'add', style: { marginTop: 10 } },
      h('div', { className: 'ab-section-title' }, '在星图上加一颗'),
      h(AddStarForm, { post })),

  ])
}

/** 星图里新增一颗星的小表单。 */

function AddStarForm({ post }) {
  const [text, setText] = useState('')
  const [imp, setImp] = useState(0.5)
  const [tier, setTier] = useState('long')
  return h('div', { className: 'ab-flex', style: { gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
    h('input', { className: 'ab-input', style: { flex: '1 1 200px' }, placeholder: '加一条记忆…', value: text, onChange: (e) => setText(e.target.value) }),
    h('input', { className: 'ab-input sm', type: 'number', min: 0, max: 1, step: 0.05, style: { width: 80 }, value: imp, onChange: (e) => setImp(Number(e.target.value) || 0) }),
    h('select', { className: 'ab-input sm', value: tier, onChange: (e) => setTier(e.target.value) },
      [['short', '临时'], ['long', '长期'], ['core', '永久']].map(([v, t]) => h('option', { key: v, value: v }, t))),
    h(Btn, { small: true, onClick: async () => {
      if (!text.trim()) return
      await post('/memory/graph/add', { text: text.trim(), importance: imp, tier })
      setText('')
    } }, '加上去'),
  )
}

export { SM_REGION, SM_TIER_LABEL, SM_EDGE_KINDS, SM_EDGE_WHITE, SM_CHILD_TINTS, SM_GROUP_TINTS, smClamp, smStarMatches, smTintIndexOf, smTintMapOf, smShortText, SM_DUST, SM_FLOW, smDraw, StarMap, AddStarForm }
