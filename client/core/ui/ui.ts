import React, { useState, useEffect, useRef } from './react.ts'
import { get } from '../api/api.ts'
import { getPath, pct, setPath } from './format.ts'

const h = React.createElement

const cx = (...a) => a.filter(Boolean).join(' ')

// ---------------- 样式（只注入一次） ----------------
const CSS = `
.ab-root{--ab-deep:#1d3b6f;--ab-sea:#3d7fd6;--ab-sky:#7fb3ee;--ab-foam:rgba(61,127,214,.10);--ab-foam-2:rgba(61,127,214,.18);
  --ab-text:var(--dsw-alias-label-primary,#1f2328);--ab-sub:var(--dsw-alias-label-secondary,#57606a);--ab-dim:var(--dsw-alias-label-tertiary,#8b949e);
  --ab-bg:var(--dsw-alias-bg-base,#fff);--ab-card:var(--dsw-alias-bg-layer-1,#fff);--ab-card-2:var(--dsw-alias-bg-layer-2,#f6f8fa);
  --ab-line:var(--dsw-alias-border-l1,rgba(0,0,0,.08));--ab-line-2:var(--dsw-alias-border-l2,rgba(0,0,0,.12));
  --ab-ok:var(--dsw-alias-state-success-primary,#1a7f37);--ab-warn:var(--dsw-alias-state-warn-primary,#bf8700);--ab-err:var(--dsw-alias-state-error-primary,#cf222e);
  --ab-hover:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04));
  height:100%;overflow:auto;background:var(--ab-bg);color:var(--ab-text);font-size:13px;line-height:1.6;
  padding:var(--dsh-frame-top-clearance,24px) 0 40px;box-sizing:border-box;font-family:var(--dsh-font-family-ui,inherit)}
body[data-ds-dark-theme] .ab-root,.ab-root.ab-dark{--ab-deep:#9cc4f5;--ab-sea:#6aa6ef;--ab-sky:#a9cdf7;--ab-foam:rgba(106,166,239,.12);--ab-foam-2:rgba(106,166,239,.22)}
.ab-wrap{max-width:1040px;margin:0 auto;padding:0 28px}
.ab-hero{display:flex;align-items:center;gap:18px;padding:18px 20px;border-radius:16px;border:1px solid var(--ab-line);
  background:linear-gradient(120deg,var(--ab-foam-2),var(--ab-foam) 45%,transparent 80%),var(--ab-card);position:relative;overflow:hidden}
.ab-hero:after{content:"";position:absolute;right:-40px;bottom:-60px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,var(--ab-foam-2),transparent 70%);pointer-events:none}
.ab-avatar{width:72px;height:72px;border-radius:50%;object-fit:cover;object-position:50% 18%;background:#fff;border:3px solid var(--ab-card);box-shadow:0 0 0 2px var(--ab-sea);flex:none}
.ab-hero h1{margin:0;font-size:20px;font-weight:650;letter-spacing:.5px;color:var(--ab-text)}
.ab-hero .ab-sub{color:var(--ab-sub);margin-top:2px}
.ab-hero-main{flex:1;min-width:0;position:relative;z-index:1}
.ab-hero-side{display:flex;flex-direction:column;gap:8px;align-items:flex-end;position:relative;z-index:1}
/* 首屏外壳骨架：bootstrap 返回前内容区只画中性占位（不闪、不做视觉改版） */
.ab-skel{border-radius:10px;background:linear-gradient(90deg,var(--ab-card-2),var(--ab-foam),var(--ab-card-2));background-size:200% 100%;animation:ab-skel 1.4s ease-in-out infinite;min-height:14px}
@keyframes ab-skel{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ab-boot-note{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 18px;border:1px solid var(--ab-line);border-radius:14px;background:var(--ab-card)}
.ab-boot-note.err{border-color:var(--ab-line-2)}
.ab-pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.ab-pill{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:12px;background:var(--ab-card-2);border:1px solid var(--ab-line);color:var(--ab-sub)}
.ab-dot{width:7px;height:7px;border-radius:50%;background:var(--ab-dim)}
.ab-dot.ok{background:var(--ab-ok)}.ab-dot.warn{background:var(--ab-warn)}.ab-dot.err{background:var(--ab-err)}
.ab-nav{position:sticky;top:0;z-index:5;margin:var(--dsh-frame-top-clearance,24px) 0 16px;border:1px solid var(--ab-line);border-radius:14px;background:var(--ab-card);background:color-mix(in srgb,var(--ab-card) 88%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 1px 2px rgba(0,0,0,.03)}
.ab-nav:before{content:"";position:absolute;left:-28px;right:-28px;bottom:calc(100% + 1px);height:var(--dsh-frame-top-clearance,24px);background:var(--ab-bg);pointer-events:none}
.ab-nav-top{display:flex;align-items:center;gap:6px;padding:6px}
.ab-nav-groups{display:flex;gap:2px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.ab-nav-groups::-webkit-scrollbar,.ab-nav-sub::-webkit-scrollbar{display:none}
.ab-grp{flex:none;position:relative;display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 14px;border:0;border-radius:10px;background:transparent;color:var(--ab-sub);font:inherit;font-size:13px;cursor:pointer;transition:background .15s,color .15s}
.ab-grp svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.ab-grp:hover{background:var(--ab-hover);color:var(--ab-text)}
.ab-grp.on{background:var(--ab-foam-2);color:var(--ab-deep);font-weight:600}
.ab-grp .dirty{position:absolute;top:6px;right:6px;width:6px;height:6px;border-radius:50%;background:var(--ab-warn)}
.ab-find-btn{flex:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 8px 0 10px;border:1px solid var(--ab-line);border-radius:9px;background:var(--ab-card-2);color:var(--ab-dim);font:inherit;font-size:12px;cursor:pointer;transition:color .15s,border-color .15s}
.ab-find-btn:hover{color:var(--ab-text);border-color:var(--ab-line-2)}
.ab-find-btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
.ab-nav-sub{display:flex;gap:2px;padding:0 8px;border-top:1px solid var(--ab-line);overflow-x:auto;scrollbar-width:none}
.ab-tab{flex:none;position:relative;border:0;background:transparent;color:var(--ab-sub);padding:9px 12px 10px;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;transition:color .15s}
.ab-tab:hover{color:var(--ab-text)}
.ab-tab:after{content:"";position:absolute;left:12px;right:12px;bottom:-1px;height:2px;border-radius:2px;background:transparent;transition:background .15s}
.ab-tab.on{color:var(--ab-deep);font-weight:600}
.ab-tab.on:after{background:var(--ab-sea)}
.ab-tab .ab-dot{width:6px;height:6px}
.ab-finder{position:absolute;right:6px;top:calc(100% + 6px);width:340px;max-width:calc(100% - 12px);padding:8px;border:1px solid var(--ab-line-2);border-radius:12px;background:var(--ab-card);box-shadow:0 14px 36px rgba(0,0,0,.16);z-index:20}
.ab-finder .ab-input{width:100%}
.ab-finder-list{margin-top:6px;max-height:300px;overflow:auto;display:flex;flex-direction:column;gap:1px}
.ab-finder-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;border-radius:8px;padding:7px 10px;font:inherit;font-size:13px;color:var(--ab-text);cursor:pointer}
.ab-finder-item small{margin-left:auto;color:var(--ab-dim);font-size:11.5px}
.ab-finder-item.on,.ab-finder-item:hover{background:var(--ab-foam)}
.ab-finder-empty{padding:12px 10px;color:var(--ab-dim);font-size:12px}
@media (max-width:640px){.ab-grp{padding:0 10px;gap:5px}.ab-find-btn .t,.ab-find-btn .ab-kbd{display:none}.ab-finder{left:6px;right:6px;width:auto;max-width:none}}
.ab-grid{display:grid;gap:12px}
.ab-pool>summary{cursor:pointer;font-weight:600}.ab-pool[open]>summary{margin-bottom:10px}
@media (max-width:640px){.ab-voice-services .ab-row .ab-ctl{width:100%}}
.ab-voice-options>summary{padding:8px 0;cursor:pointer;font-weight:560}
.ab-market-grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))}
.ab-market-grid>.ab-card{content-visibility:auto;contain-intrinsic-block-size:auto 180px}
.ab-permission-grid{display:grid;grid-template-columns:minmax(220px,1fr) minmax(0,2fr);gap:12px;align-items:start}
.ab-permission-grid>.ab-card{padding:14px 16px}
.ab-permission-grid>.ab-card h3{margin-bottom:2px}
.ab-permission-grid>.ab-card .ab-desc{margin:3px 0 8px;line-height:1.45}
.ab-permission-people{display:grid;gap:3px;margin:8px 0 0;max-height:370px;overflow:auto}
.ab-permission-person-row{display:flex;align-items:center;gap:6px;min-width:0}
.ab-permission-person{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;padding:6px 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--ab-text);font:inherit;cursor:pointer}
.ab-permission-person-row>.ab-permission-person{flex:1;min-width:0;width:100%}
.ab-permission-person:hover,.ab-permission-person.on{border-color:var(--ab-line);background:var(--ab-foam)}
.ab-permission-person small{display:block;color:var(--ab-sub)}
.ab-permission-bulk{margin-top:8px;padding:10px 12px;border:1px solid var(--ab-line);border-radius:10px;background:var(--ab-foam)}
.ab-permission-bulk>p{margin:4px 0 8px}
.ab-permission-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
.ab-permission-options .ab-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px 10px;padding:10px 12px;border:1px solid var(--ab-line);border-radius:10px}
.ab-permission-options .ab-row .ab-label{flex:none;min-width:0;padding-top:0}
.ab-permission-options .ab-row .ab-label small{max-width:none}
.ab-permission-options .ab-row .ab-ctl{flex:none;grid-column:2;grid-row:1;justify-content:flex-end}
.ab-permission-group-row .ab-ctl{justify-content:flex-end}
.ab-permission-section h4{margin:10px 0 4px}
@media(max-width:800px){.ab-permission-grid{grid-template-columns:1fr}.ab-permission-people{max-height:190px}}
.ab-g2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.ab-g4{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.ab-card{background:var(--ab-card);border:1px solid var(--ab-line);border-radius:14px;padding:16px 18px}
.ab-card h3{margin:0 0 4px;font-size:14px;font-weight:620;display:flex;align-items:center;gap:8px}
.ab-card .ab-desc{color:var(--ab-sub);font-size:12.5px;margin:0 0 12px}
/* 「关于」页：三张通栏大卡 + 两张可折叠门帘 */
.ab-about-lead{grid-column:1/-1;padding:20px 22px;border-radius:16px;box-shadow:var(--ab-shadow)}
.ab-about-lead h3{font-size:16px;margin-bottom:6px}
.ab-about-lead p{line-height:1.65;font-size:13.5px;margin:0}
.ab-about-sum{grid-column:1/-1;border:1px solid var(--ab-line);border-radius:14px;background:var(--ab-card);padding:0 20px;box-shadow:var(--ab-shadow)}
.ab-about-sum summary{cursor:pointer;padding:14px 0;font-weight:600;font-size:14px;color:var(--ab-text);list-style:none;display:flex;align-items:center;gap:10px;user-select:none}
.ab-about-sum summary::-webkit-details-marker{display:none}
.ab-about-sum summary .chev{margin-left:auto;color:var(--ab-dim);font-size:12px;transition:transform .15s}
.ab-about-sum[open] summary .chev{transform:rotate(90deg)}
.ab-about-sum .inner{padding:14px 0 18px;border-top:1px solid var(--ab-line)}
.ab-about-chip{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--ab-line-2);border-radius:999px;padding:6px 14px;font-size:13px;background:var(--ab-foam);font-weight:560}
.ab-about-chip b{color:var(--ab-deep);font-variant-numeric:tabular-nums}
/* 核心开发者：上头像、下名字，竖排居中。头像拉不到时露出首字母，不留破图 */
.ab-devs{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-top:16px}
.ab-dev{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:18px 12px 14px;border:1px solid var(--ab-line);border-radius:14px;background:var(--ab-card-2);min-width:0}
.ab-dev .av{position:relative;width:64px;height:64px;border-radius:50%;overflow:hidden;flex:none;display:flex;align-items:center;justify-content:center;background:var(--ab-foam);border:1px solid var(--ab-line-2);font-weight:650;font-size:22px;color:var(--ab-deep)}
.ab-dev .av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.ab-dev .who{min-width:0;width:100%}
.ab-dev .nm{display:block;font-weight:600;font-size:13.5px;color:var(--ab-text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ab-dev .nm:hover{color:var(--ab-sea);text-decoration:underline}
/* contrib.rocks 自动更新的贡献者头像墙 */
.ab-contrib{display:block;margin:0 0 14px}
.ab-contrib img{display:block;max-width:100%;height:auto}
.ab-stat{padding:14px 16px}
.ab-stat .n{font-size:24px;font-weight:650;color:var(--ab-deep);font-variant-numeric:tabular-nums}
.ab-stat .l{color:var(--ab-sub);font-size:12px}
.ab-row{display:flex;align-items:flex-start;gap:16px;padding:10px 0;border-top:1px solid var(--ab-line)}
.ab-row:first-of-type{border-top:0}
.ab-row .ab-label{flex:0 0 180px;padding-top:5px}
.ab-row .ab-label b{display:block;font-weight:560}
.ab-row .ab-label small{display:block;color:var(--ab-dim);font-size:11.5px;line-height:1.45;margin-top:2px}
.ab-row .ab-ctl{flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
@media (max-width:640px){.ab-row{flex-direction:column;gap:6px}.ab-row .ab-label{flex:none}.ab-wrap{padding:0 14px}.ab-hero{flex-wrap:wrap}.ab-hero-side{align-items:flex-start}}
.ab-input,.ab-select,.ab-textarea{border:1px solid var(--ab-line-2);border-radius:8px;padding:6px 10px;background:var(--ab-card);color:var(--ab-text);font:inherit;outline:none;min-width:0;box-sizing:border-box}
.ab-input:focus,.ab-select:focus,.ab-textarea:focus{border-color:var(--ab-sea);box-shadow:0 0 0 3px var(--ab-foam-2)}
.ab-input{width:240px;max-width:100%}.ab-input.sm{width:90px}.ab-input.wide{width:100%}
.ab-textarea{width:100%;min-height:90px;resize:vertical;line-height:1.55;font-family:var(--dsh-font-family-code,ui-monospace,monospace);font-size:12.5px}
.ab-btn{border:1px solid var(--ab-line-2);background:var(--ab-card);color:var(--ab-text);padding:6px 14px;border-radius:8px;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.ab-btn:hover{background:var(--ab-hover)}
.ab-btn:disabled{opacity:.5;cursor:default}
.ab-btn.primary{background:var(--ab-sea);border-color:var(--ab-sea);color:#fff}
.ab-btn.primary:hover{filter:brightness(1.07)}
.ab-btn.danger{color:var(--ab-err)}
.ab-btn.ghost{border-color:transparent;background:transparent;color:var(--ab-sub)}
.ab-btn.sm{padding:3px 10px;font-size:12px}
.ab-switch{position:relative;width:38px;height:22px;border-radius:999px;background:var(--ab-line-2);border:0;cursor:pointer;flex:none;transition:background .15s}
.ab-switch:after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .15s}
.ab-switch.on{background:var(--ab-sea)}.ab-switch.on:after{left:19px}
.ab-switch-row{display:flex;align-items:center;gap:10px}
.ab-seg{display:inline-flex;border:1px solid var(--ab-line-2);border-radius:9px;overflow:hidden}
.ab-seg button{border:0;background:transparent;padding:6px 14px;font:inherit;color:var(--ab-sub);cursor:pointer;border-left:1px solid var(--ab-line)}
.ab-seg button:first-child{border-left:0}
.ab-seg button.on{background:var(--ab-foam-2);color:var(--ab-deep);font-weight:600}
.ab-seg.off{opacity:.45}
.ab-seg.off button{cursor:not-allowed}
.ab-note{padding:10px 12px;border-radius:10px;background:var(--ab-foam);color:var(--ab-text);font-size:12.5px;border:1px solid var(--ab-foam-2)}
.ab-note.warn{background:rgba(191,135,0,.08);border-color:rgba(191,135,0,.25)}
.ab-note.err{background:rgba(207,34,46,.07);border-color:rgba(207,34,46,.25)}
.ab-steps{counter-reset:s;display:flex;flex-direction:column;gap:10px}
.ab-step{display:flex;gap:12px;align-items:flex-start}
.ab-step:before{counter-increment:s;content:counter(s);flex:none;width:22px;height:22px;border-radius:50%;background:var(--ab-foam-2);color:var(--ab-deep);font-weight:650;display:flex;align-items:center;justify-content:center;font-size:12px}
.ab-step.done:before{content:"✓";background:var(--ab-ok);color:#fff}
.ab-step > div{flex:1;min-width:0}
.ab-kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12.5px}
.ab-kv span:nth-child(odd){color:var(--ab-sub)}
.ab-stickers{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}
.ab-shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px}
.ab-shot{border:1px solid var(--ab-line);border-radius:12px;padding:6px;background:var(--ab-card);display:flex;flex-direction:column;gap:6px;position:relative}
.ab-shot img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;background:var(--ab-card-2);display:block}
.ab-shot .cap{font-size:11px;color:var(--ab-dim);line-height:1.35;max-height:2.7em;overflow:hidden}
.ab-shot .x{position:absolute;top:10px;right:10px;opacity:0;transition:opacity .15s}
.ab-shot:hover .x{opacity:1}
.ab-sticker{border:1px solid var(--ab-line);border-radius:12px;padding:8px;background:var(--ab-card);display:flex;flex-direction:column;gap:6px;position:relative}
.ab-sticker img{width:100%;aspect-ratio:1;object-fit:contain;border-radius:8px;background:var(--ab-card-2)}
.ab-sticker .nm,.ab-sticker .tg{border:1px dashed transparent;background:transparent;text-align:center;width:100%;outline:none;padding:2px 4px;border-radius:6px;box-sizing:border-box}
.ab-sticker .nm{font-size:12px;color:var(--ab-text)}
.ab-sticker .tg{font-size:11px;color:var(--ab-dim);min-height:16px}
.ab-sticker:hover .nm,.ab-sticker:hover .tg{border-color:var(--ab-line)}
.ab-sticker .nm:focus,.ab-sticker .tg:focus{background:var(--ab-card-2);border-style:solid;border-color:var(--ab-line)}
.ab-sticker.pick{cursor:pointer}
.ab-sticker.on{border-color:var(--ab-sea);box-shadow:0 0 0 2px var(--ab-foam-2)}
.ab-sticker .ck{position:absolute;top:6px;left:6px;z-index:2;width:20px;height:20px;border-radius:7px;border:1.5px solid var(--ab-line-2);background:var(--ab-card);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;line-height:1;color:#fff;transition:background .12s,border-color .12s}
.ab-sticker.on .ck{background:var(--ab-sea);border-color:var(--ab-sea)}
.ab-sticker.pick .nm,.ab-sticker.pick .tg{pointer-events:none}
.ab-stickers.picking .ab-sticker .x{display:none}
.ab-progress{height:6px;border-radius:999px;background:var(--ab-card-2);border:1px solid var(--ab-line);overflow:hidden;flex:1 1 140px;min-width:110px}
.ab-progress > i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--ab-sky),var(--ab-sea));transition:width .3s}
.ab-sticker .x{position:absolute;top:4px;right:4px;opacity:0;transition:opacity .15s}
.ab-sticker:hover .x{opacity:1}
.ab-list{display:flex;flex-direction:column}
.ab-li{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--ab-line);content-visibility:auto;contain-intrinsic-size:56px}
.ab-li:first-child{border-top:0}
.ab-li .meta{color:var(--ab-dim);font-size:11.5px;white-space:nowrap}
.ab-li .body{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word}
.ab-logs{font-family:var(--dsh-font-family-code,ui-monospace,monospace);font-size:12px;max-height:520px;overflow:auto;border-radius:10px;background:var(--ab-card-2);padding:8px 0}
.ab-log{display:flex;gap:10px;padding:2px 12px;align-items:baseline}
.ab-log:hover{background:var(--ab-hover)}
.ab-log .t{color:var(--ab-dim);flex:none}
.ab-log .a{flex:none;color:var(--ab-sea);min-width:62px}
.ab-log .m{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word}
.ab-log.warn .m{color:var(--ab-warn)}.ab-log.error .m{color:var(--ab-err)}.ab-log.debug .m{color:var(--ab-dim)}
.ab-persona{display:grid;grid-template-columns:240px 1fr;gap:12px}
@media (max-width:760px){.ab-persona{grid-template-columns:1fr}}
.ab-pm{display:grid;gap:12px;min-width:0;overflow-wrap:anywhere}
.ab-pm-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ab-pm-count{color:var(--ab-sub);font-size:12.5px}
.ab-pm-face{flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;overflow:hidden;font-weight:620;font-size:14px;color:#fff;background:var(--ab-sea)}
.ab-pm-face img{width:100%;height:100%;object-fit:cover;display:block}
.ab-pm-face.big{width:64px;height:64px;font-size:24px}
.ab-pm-split{display:grid;grid-template-columns:272px minmax(0,1fr);gap:12px;align-items:start}
.ab-pm-graph{grid-template-columns:minmax(0,1fr)}
.ab-pm-graph.open{grid-template-columns:minmax(320px,1fr) minmax(0,1fr)}
.ab-pm-graph .ab-pm-list{position:static;max-height:none;min-width:0}
.ab-pm-stars{max-height:650px;overflow:auto;overscroll-behavior:contain}
.ab-pm-stars svg{display:block;width:100%;max-width:560px;margin:auto;touch-action:pan-y}
.ab-pm-stars g[role=button]{cursor:pointer;outline:none}
.ab-pm-stars g[role=button]:focus-visible circle{stroke:var(--ab-text);stroke-width:3}
.ab-pm-related{margin-top:6px;font-size:12px;line-height:1.6}
.ab-pm-related article{padding:7px 9px;margin-top:5px;background:var(--ab-foam);border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}
.ab-pm-related .text{text-decoration:none!important}
.ab-pm-platforms{overflow-x:auto}
.ab-pm-list{display:flex;flex-direction:column;border:1px solid var(--ab-line);border-radius:14px;background:var(--ab-card);overflow:visible;position:sticky;top:64px;z-index:1;max-height:calc(100vh - 96px)}
.ab-pm-search{position:relative;z-index:2;padding:10px;border-bottom:1px solid var(--ab-line)}
.ab-pm-search input{width:100%;box-sizing:border-box}
.ab-pm-search .ab-sel{flex:1 1 100px;min-width:0;max-width:100%}
.ab-pm-search .ab-sel-pop{box-sizing:border-box;min-width:max(100%,160px);max-width:min(320px,calc(100vw - 32px))}
.ab-pm-search .ab-sel:last-child .ab-sel-pop{left:auto;right:0}
.ab-pm-search .ab-sel-opt .tx{white-space:normal;overflow-wrap:anywhere}
.ab-pm-rows{overflow-y:auto;min-height:0;padding:4px}
.ab-pm-row{display:flex;align-items:center;gap:10px;width:100%;padding:8px;border:0;border-radius:10px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ab-pm-row:hover{background:var(--ab-card-2)}
.ab-pm-row.on{background:var(--ab-foam-2)}
.ab-pm-row .who{min-width:0;flex:1}
.ab-pm-row .name{display:flex;align-items:center;gap:6px;font-size:13.5px;font-weight:600}
.ab-pm-row .name span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ab-pm-row .line{color:var(--ab-sub);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.ab-pm-own{flex:none;padding:0 6px;border-radius:999px;font-size:11px;font-weight:500;color:var(--ab-deep);background:var(--ab-foam-2)}
.ab-pm-detail{display:grid;gap:12px;min-width:0}
.ab-pm-hero{display:flex;gap:14px;align-items:flex-start;padding:18px;border:1px solid var(--ab-line);border-radius:14px;background:linear-gradient(120deg,var(--ab-foam-2),transparent 70%),var(--ab-card)}
.ab-pm-hero .body{min-width:0;flex:1}
.ab-pm-hero h3{margin:0;font-size:18px;font-weight:640}
.ab-pm-hero .meta{color:var(--ab-sub);font-size:12px;margin-top:2px}
.ab-pm-hero .quote{margin:10px 0 0;font-size:14px;line-height:1.65;white-space:pre-wrap}
.ab-pm-hero .quote.empty{color:var(--ab-dim)}
.ab-pm-traits{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:10px}
.ab-pm-trait{padding:12px 14px;border:1px solid var(--ab-line);border-radius:12px;background:var(--ab-card);min-width:0}
.ab-pm-trait .k{color:var(--ab-sub);font-size:12px}
.ab-pm-trait .v{margin-top:3px;font-size:13.5px;line-height:1.55}
.ab-pm-trait .v.empty{color:var(--ab-dim)}
.ab-pm-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px 14px}
.ab-pm-form label{display:block;min-width:0;color:var(--ab-sub);font-size:12px}
.ab-pm-form textarea{display:block;width:100%;box-sizing:border-box;margin-top:4px;font-family:inherit}
.ab-pm-form .full{grid-column:1/-1}
.ab-pm-fact{display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--ab-line);min-width:0}
.ab-pm-fact:first-child{border-top:0;padding-top:2px}
.ab-pm-fact.old{opacity:.6}
.ab-pm-dot{flex:none;width:7px;height:7px;margin-top:7px;border-radius:50%;background:var(--ab-line-2)}
.ab-pm-dot.t0{background:var(--ab-gold,#d4a44c)}.ab-pm-dot.t3{background:var(--ab-deep)}.ab-pm-dot.t2{background:var(--ab-sea)}
.ab-pm-fact .main{min-width:0;flex:1}
.ab-pm-fact .text{font-size:13.5px;line-height:1.55;white-space:pre-wrap}
.ab-pm-fact.old .text{text-decoration:line-through}
.ab-pm-fact .sub{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:3px;color:var(--ab-sub);font-size:12px}
.ab-pm-tag{padding:0 6px;border-radius:999px;font-size:11px;background:var(--ab-card-2);border:1px solid var(--ab-line)}
.ab-pm-tag.warn{color:var(--ab-warn)}
.ab-pm-acts{flex:none;display:flex;gap:4px;opacity:0;transition:opacity .12s}
.ab-pm-fact:hover .ab-pm-acts,.ab-pm-fact:focus-within .ab-pm-acts,.ab-pm-tl-item:hover .ab-pm-acts,.ab-pm-tl-item:focus-within .ab-pm-acts{opacity:1}
.ab-pm-link{border:0;background:none;padding:2px 4px;color:var(--ab-sub);font:inherit;font-size:12px;cursor:pointer;border-radius:6px}
.ab-pm-link:hover{background:var(--ab-card-2);color:var(--ab-text,inherit)}
.ab-pm-link.danger:hover{color:var(--ab-err)}
.ab-pm-groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px}
.ab-pm-group{display:flex;flex-direction:column;gap:8px;padding:16px;border:1px solid var(--ab-line);border-radius:14px;background:var(--ab-card);min-width:0}
.ab-pm-group .top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.ab-pm-group .name{font-size:12.5px;color:var(--ab-sub)}
.ab-pm-group .vibe{font-size:16px;font-weight:620;line-height:1.4}
.ab-pm-group .vibe.empty{color:var(--ab-dim);font-weight:500;font-size:14px}
.ab-pm-group .chips{display:flex;flex-wrap:wrap;gap:5px}
.ab-pm-chip{padding:1px 8px;border-radius:999px;font-size:12px;color:var(--ab-deep);background:var(--ab-foam-2)}
.ab-pm-group .note{font-size:13px;line-height:1.55;color:var(--ab-sub)}
.ab-pm-group .foot{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:4px;color:var(--ab-dim);font-size:12px}
.ab-pm-filters{display:flex;gap:8px;flex-wrap:wrap}
.ab-pm-filters .ab-select{max-width:100%}
.ab-pm-tl{position:relative;padding-left:20px}
.ab-pm-tl:before{content:"";position:absolute;left:5px;top:6px;bottom:6px;width:1px;background:var(--ab-line-2)}
.ab-pm-tl-day{position:relative;margin:14px 0 6px;color:var(--ab-sub);font-size:12px;font-weight:600}
.ab-pm-tl-day:first-child{margin-top:0}
.ab-pm-tl-item{position:relative;display:flex;gap:8px;padding:6px 0;min-width:0}
.ab-pm-tl-item:before{content:"";position:absolute;left:-18px;top:13px;width:7px;height:7px;border-radius:50%;background:var(--ab-card);box-shadow:0 0 0 2px var(--ab-sea)}
.ab-pm-tl-item .main{min-width:0;flex:1}
.ab-pm-tl-item .text{font-size:13.5px;line-height:1.6}
.ab-pm-tl-item .from{color:var(--ab-dim);font-size:12px;margin-top:1px}
.ab-pm-tl-item.feel:before{left:-20px;top:14px;width:11px;height:11px;background:var(--ab-deep);box-shadow:0 0 0 3px var(--ab-foam-2)}
.ab-pm-tl-item.feel .text{font-size:16px;font-weight:600;color:var(--ab-deep)}
@media (max-width:760px){
.ab-pm-split,.ab-pm-graph.open{grid-template-columns:minmax(0,1fr)}
.ab-pm-list{position:static;max-height:none}
.ab-pm-split.open .ab-pm-list{display:none}
.ab-pm-acts{opacity:1}
}
@media (min-width:761px){.ab-pm-back{display:none}}
.ab-memory-entry .ab-flex{margin-top:5px}
.ab-plist{display:flex;flex-direction:column;gap:6px}
.ab-pitem{text-align:left;border:1px solid var(--ab-line);background:var(--ab-card);border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--ab-text);font:inherit}
.ab-pitem:hover{border-color:var(--ab-line-2)}
.ab-pitem.on{border-color:var(--ab-sea);box-shadow:0 0 0 3px var(--ab-foam)}
.ab-pitem .nm{font-weight:600;display:flex;align-items:center;gap:6px}
.ab-pitem .tg{color:var(--ab-dim);font-size:11.5px;margin-top:2px}
.ab-badge{font-size:10.5px;padding:0 6px;border-radius:999px;background:var(--ab-sea);color:#fff;font-weight:500}
.ab-psecs{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.ab-psec{--c:var(--ab-sea);position:relative;overflow:hidden;border:1px solid var(--ab-line);border-radius:14px;background:var(--ab-card);background:radial-gradient(120% 140% at 0 0,color-mix(in srgb,var(--c) 7%,transparent),transparent 46%),var(--ab-card);transition:border-color .2s,box-shadow .2s}
.ab-psec:before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:0 3px 3px 0;background:var(--c);background:linear-gradient(180deg,var(--c),color-mix(in srgb,var(--c) 18%,transparent))}
.ab-psec:hover{border-color:color-mix(in srgb,var(--c) 22%,var(--ab-line))}
.ab-psec:focus-within{border-color:var(--c);border-color:color-mix(in srgb,var(--c) 38%,var(--ab-line));box-shadow:0 0 0 3px var(--ab-foam);box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 8%,transparent),0 6px 18px -10px color-mix(in srgb,var(--c) 45%,transparent)}
.ab-psec-head{display:flex;align-items:center;gap:4px;padding:10px 8px 0 18px}
.ab-psec-head:before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--c);margin-right:8px;opacity:.9}
.ab-psec-title{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-weight:600;font-size:13.5px;letter-spacing:.02em;color:var(--ab-text);color:color-mix(in srgb,var(--c) 42%,var(--ab-text));padding:4px 0;outline:none}
.ab-psec-title::placeholder{color:var(--ab-dim);font-weight:400}
.ab-psec-fixed{flex:1;min-width:0;font-weight:620;font-size:13.5px;padding:4px 0}
.ab-psec-fixed small{font-weight:400;color:var(--ab-dim);margin-left:8px;font-size:11.5px}
.ab-psec-n{font-size:11px;color:var(--ab-dim);font-variant-numeric:tabular-nums;margin-right:4px}
.ab-psec-act{display:flex;align-items:center;gap:2px;opacity:.5;transition:opacity .12s}
.ab-psec:hover .ab-psec-act,.ab-psec:focus-within .ab-psec-act{opacity:1}
.ab-ibtn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:var(--ab-sub);cursor:pointer;padding:0}
.ab-ibtn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ab-ibtn:hover{background:var(--ab-hover);color:var(--ab-text)}
.ab-ibtn.danger:hover{color:var(--ab-err)}
.ab-ibtn:disabled{opacity:.3;cursor:default;background:transparent}
.ab-aibtn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;margin-left:2px;border:0;border-radius:7px;background:var(--ab-foam);color:var(--ab-deep);font:inherit;font-size:12px;cursor:pointer;transition:background .12s}
.ab-aibtn:hover,.ab-aibtn.on{background:var(--ab-foam-2)}
.ab-psec .ab-aibtn{background:transparent;color:var(--ab-sub);opacity:.5;transition:opacity .12s,background .12s,color .12s}
.ab-psec:hover .ab-aibtn,.ab-psec:focus-within .ab-aibtn{opacity:1}
.ab-psec .ab-aibtn:hover,.ab-psec .ab-aibtn:disabled{background:color-mix(in srgb,var(--c) 10%,transparent);color:color-mix(in srgb,var(--c) 65%,var(--ab-text));opacity:1}
.ab-aibtn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ab-psec textarea{display:block;width:100%;box-sizing:border-box;border:0;background:transparent;resize:vertical;outline:none;padding:6px 16px 12px 30px;font:inherit;font-size:13px;line-height:1.75;color:var(--ab-text)}
.ab-psec textarea::placeholder{color:var(--ab-dim)}
.ab-psec.cmp{border-color:var(--c);border-color:color-mix(in srgb,var(--c) 45%,var(--ab-line));box-shadow:0 0 0 3px var(--ab-foam);box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 10%,transparent)}
.ab-chip.on{border-style:solid;border-color:var(--ab-sea);background:var(--ab-foam-2);color:var(--ab-deep);font-weight:600}
.ab-chip .n{margin-left:6px;font-size:11px;color:var(--ab-dim);font-weight:400}
.ab-tf-who{margin-top:8px;font-size:12px;color:var(--ab-sub);line-height:1.6}
.ab-psec.cmp textarea{cursor:default}
.ab-compare{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 12px 12px;padding:8px 8px 8px 12px;border-radius:10px;background:var(--ab-foam)}
.ab-compare-tag{font-size:11.5px;font-weight:600;color:var(--ab-deep);padding:1px 8px;border-radius:999px;background:var(--ab-card);border:1px solid var(--ab-foam-2)}
.ab-psec-add{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:12px}
.ab-chip{border:1px dashed var(--ab-line-2);background:transparent;color:var(--ab-sub);border-radius:999px;padding:3px 12px;font:inherit;font-size:12px;cursor:pointer;transition:border-color .12s,color .12s,background .12s}
.ab-chip:hover{border-color:var(--ab-sea);color:var(--ab-deep);background:var(--ab-foam)}
.ab-chip.solid{border-style:solid}
.ab-mood{height:10px;border-radius:999px;background:var(--ab-card-2);overflow:hidden;border:1px solid var(--ab-line)}
.ab-mood > i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--ab-sky),var(--ab-sea))}
.ab-savebar{position:sticky;bottom:12px;margin-top:16px;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:12px;background:var(--ab-card);border:1px solid var(--ab-sea);box-shadow:0 6px 24px rgba(0,0,0,.12);z-index:6}
.ab-savebar .msg{flex:1;color:var(--ab-deep);font-weight:560}
.ab-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);padding:9px 16px;border-radius:10px;background:var(--dsw-alias-toast-bg,#1f2328);color:var(--dsw-alias-toast-label,#fff);font-size:13px;z-index:50;box-shadow:0 6px 24px rgba(0,0,0,.2);max-width:80vw}
.ab-empty{padding:28px 12px;text-align:center;color:var(--ab-dim)}
.ab-empty .big{font-size:28px;margin-bottom:4px}
.ab-table{width:100%;border-collapse:collapse;font-size:12.5px}
.ab-table th{text-align:left;color:var(--ab-sub);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--ab-line)}
.ab-table td{padding:6px 8px;border-bottom:1px solid var(--ab-line)}
.ab-flex{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ab-spacer{flex:1}
.ab-muted{color:var(--ab-sub)}
.ab-small{font-size:12px}
.ab-section-title{font-size:12px;font-weight:600;color:var(--ab-dim);letter-spacing:.06em;margin:18px 2px 8px}
.ab-fold{display:flex;align-items:center;gap:6px;width:100%;background:none;border:0;padding:0;font:inherit;text-align:left;cursor:pointer}
.ab-fold:hover{color:var(--ab-text)}
.ab-fold-arrow{width:12px;display:inline-block;flex:0 0 12px}
/* token 用量面板：指标卡 + 小标签 + 数字右对齐，别糊成一坨 */
/* Usage is read-only: one entry card, detailed tables scroll inside the card on phones. */
.ab-usage{min-width:0}
.ab-usage>.ab-card{min-width:0;max-width:100%;box-sizing:border-box}
.ab-usage-summary{display:flex;flex-direction:column;align-items:flex-start;gap:8px;text-align:left;color:var(--ab-text);font:inherit;cursor:pointer;width:100%}
.ab-usage-summary:hover{border-color:var(--ab-sea)}
.ab-usage-summary:focus-visible{outline:2px solid var(--ab-sea);outline-offset:2px}
.ab-usage-number{font-size:30px;line-height:1.2;color:var(--ab-deep);font-variant-numeric:tabular-nums}
.ab-usage-table{max-width:100%;overflow-x:auto;margin-top:12px}
.ab-usage-table table{min-width:680px}
.ab-usage-table th,.ab-usage-table td{white-space:nowrap}
.ab-usage-table td:first-child{white-space:normal;min-width:150px;max-width:280px;overflow-wrap:anywhere}
.ab-usage summary{cursor:pointer}

.ab-table.num th:not(:first-child),.ab-table.num td:not(:first-child){text-align:right}
.ab-table.num td:not(:first-child){font-variant-numeric:tabular-nums}
.ab-table.num .money{font-weight:600;color:var(--ab-deep)}
.ab-table.num tbody tr:last-child td{border-bottom:0}
.ab-sel{position:relative;display:inline-block;min-width:200px;max-width:100%}
.ab-sel-btn{width:100%;display:flex;align-items:center;gap:8px;border:1px solid var(--ab-line-2);border-radius:9px;padding:6px 10px;background:var(--ab-card);color:var(--ab-text);font:inherit;cursor:pointer;text-align:left}
.ab-sel-btn:hover{border-color:var(--ab-sky)}
.ab-sel-btn:focus-visible,.ab-sel.open .ab-sel-btn{outline:none;border-color:var(--ab-sea);box-shadow:0 0 0 3px var(--ab-foam-2)}
.ab-sel-btn .v{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ab-sel-btn .chev{flex:none;color:var(--ab-dim);transition:transform .15s}
.ab-sel.open .chev{transform:rotate(180deg)}
.ab-sel-pop{position:absolute;z-index:40;top:calc(100% + 6px);left:0;min-width:100%;max-height:300px;overflow:auto;padding:5px;border-radius:12px;background:var(--ab-card);border:1px solid var(--ab-line-2);box-shadow:0 12px 32px rgba(0,0,0,.16);animation:abPop .12s ease-out}
@keyframes abPop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.ab-sel-opt{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;color:var(--ab-text);white-space:nowrap}
.ab-sel-opt .ck{width:14px;flex:none;color:var(--ab-sea);font-weight:700}
.ab-sel-opt .tx{flex:1;min-width:0}
.ab-sel-opt .ds{display:block;font-size:11.5px;color:var(--ab-dim);margin-top:1px;white-space:normal}
.ab-sel-opt.act{background:var(--ab-hover)}
.ab-sel-opt.on{background:var(--ab-foam);color:var(--ab-deep);font-weight:560}
.ab-sel-group{font-size:11px;color:var(--ab-dim);padding:6px 10px 2px;letter-spacing:.04em}
.ab-choices{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;width:100%}
.ab-choice{border:1px solid var(--ab-line-2);border-radius:12px;padding:10px 12px;background:var(--ab-card);cursor:pointer;text-align:left;font:inherit;color:var(--ab-text);transition:border-color .12s,box-shadow .12s}
.ab-choice:hover{border-color:var(--ab-sky)}
.ab-choice.on{border-color:var(--ab-sea);box-shadow:0 0 0 3px var(--ab-foam);background:linear-gradient(var(--ab-foam),var(--ab-foam)),var(--ab-card)}
.ab-choice b{display:flex;align-items:center;gap:6px;font-weight:600}
.ab-choice small{display:block;color:var(--ab-dim);font-size:11.5px;margin-top:3px;line-height:1.45}
.ab-choice-pin{position:absolute;right:8px;top:8px;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;color:var(--ab-dim);opacity:.55;cursor:pointer;transition:opacity .12s,color .12s,background .12s}
.ab-choice-pin:hover{opacity:1;background:var(--ab-hover)}
.ab-choice-pin.on{opacity:1;color:var(--ab-sea);background:var(--ab-foam)}
.ab-choice-more{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:78px}
.ab-choice-more b{justify-content:center}
.ab-choice-more small{text-align:center}
.ab-tab .dirty{width:6px;height:6px;border-radius:50%;background:var(--ab-warn)}
.ab-toast.ok{background:var(--ab-ok);color:#fff}.ab-toast.err{background:var(--ab-err);color:#fff}
.ab-kbd{font-family:var(--dsh-font-family-code,monospace);font-size:11px;padding:0 5px;border:1px solid var(--ab-line-2);border-radius:5px;color:var(--ab-dim)}
.ab-spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:abSpin .7s linear infinite;vertical-align:-2px}
@keyframes abSpin{to{transform:rotate(360deg)}}
.ab-drop{border:2px dashed var(--ab-line-2);border-radius:12px;padding:22px 16px;text-align:center;color:var(--ab-sub);cursor:pointer;transition:border-color .15s,background .15s}
.ab-drop:hover,.ab-drop:focus-visible{border-color:var(--ab-sky);outline:none}
.ab-drop.over{border-color:var(--ab-sea);background:var(--ab-foam);color:var(--ab-deep)}
.ab-avatar-btn{position:relative;padding:0;border:0;background:none;cursor:pointer;border-radius:50%;flex:none}
.ab-avatar-btn .ab-avatar-tip{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(15,40,80,.45);color:#fff;font-size:12px;opacity:0;transition:opacity .15s}
.ab-avatar-btn:hover .ab-avatar-tip,.ab-avatar-btn:focus-visible .ab-avatar-tip{opacity:1}
.ab-wiz-bar{display:flex;gap:6px;margin-top:12px}
.ab-wiz-bar .seg{flex:1;border:0;background:transparent;padding:0;cursor:default;text-align:left;font:inherit;color:var(--ab-dim)}
.ab-wiz-bar .seg:before{content:"";display:block;height:4px;border-radius:999px;background:var(--ab-line-2);margin-bottom:6px}
.ab-wiz-bar .seg.done{cursor:pointer;color:var(--ab-sub)}.ab-wiz-bar .seg.done:before{background:var(--ab-sky)}
.ab-wiz-bar .seg.on{color:var(--ab-deep);font-weight:600}.ab-wiz-bar .seg.on:before{background:var(--ab-sea)}
.ab-wiz-bar .seg span{font-size:11.5px}
@media (max-width:640px){.ab-wiz-bar .seg span{display:none}}
.ab-range{display:flex;align-items:center;gap:10px;min-width:240px}
.ab-range input[type=range]{flex:1;accent-color:var(--ab-sea)}
.ab-range .val{min-width:48px;text-align:right;font-variant-numeric:tabular-nums;color:var(--ab-deep);font-weight:600}
/* ---------- 美化 ---------- */
.ab-root{--ab-shadow:0 1px 2px rgba(15,40,80,.04),0 4px 16px rgba(15,40,80,.05);--ab-radius:16px}
body[data-ds-dark-theme] .ab-root,.ab-root.ab-dark{--ab-shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.25)}
.ab-hero{padding:20px 22px;border-radius:20px;box-shadow:var(--ab-shadow);background:
  radial-gradient(120% 140% at 0% 0%,var(--ab-foam-2),transparent 55%),
  linear-gradient(120deg,var(--ab-foam),transparent 70%),var(--ab-card)}
.ab-hero:before{content:"";position:absolute;left:0;right:0;bottom:-1px;height:46px;pointer-events:none;opacity:.55;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 60' preserveAspectRatio='none'%3E%3Cpath d='M0 30c150-26 300 26 450 0s300-26 450 0 225 18 300 8v22H0z' fill='%233d7fd6' fill-opacity='.10'/%3E%3Cpath d='M0 42c180-20 330 18 520 2s340-16 480 2 150 8 200 4v10H0z' fill='%233d7fd6' fill-opacity='.08'/%3E%3C/svg%3E") bottom/100% 100% no-repeat}
.ab-hero h1{font-size:22px}
.ab-pill{background:var(--ab-card);box-shadow:0 1px 1px rgba(15,40,80,.04)}
.ab-grid{gap:14px}
.ab-card{border-radius:var(--ab-radius);padding:18px 20px;box-shadow:var(--ab-shadow);transition:box-shadow .15s}
.ab-card h3{font-size:15px;font-weight:650;color:var(--ab-text)}
.ab-card h3:before{content:"";width:4px;height:15px;border-radius:2px;background:linear-gradient(var(--ab-sky),var(--ab-sea));flex:none}
.ab-card .ab-desc{margin:4px 0 14px;line-height:1.65}
.ab-stat{position:relative;overflow:hidden;padding:16px 18px;background:linear-gradient(150deg,var(--ab-foam),transparent 60%),var(--ab-card)}
.ab-stat .ic{position:absolute;right:14px;top:12px;font-size:22px;opacity:.9}
.ab-stat .n{font-size:28px;line-height:1.2}
.ab-row{padding:12px 0;gap:20px}
.ab-row .ab-label{flex:0 0 200px}
.ab-row .ab-label small{max-width:200px}
.ab-range{max-width:440px}
.ab-range .val{min-width:0;padding:1px 9px;border-radius:999px;background:var(--ab-foam);font-size:12px;white-space:nowrap}
.ab-range input[type=range]{height:4px}
.ab-input,.ab-select,.ab-textarea,.ab-sel-btn{border-radius:10px;transition:border-color .12s,box-shadow .12s}
.ab-input:hover,.ab-textarea:hover{border-color:var(--ab-sky)}
.ab-textarea{font-family:inherit;font-size:13px}
.ab-btn{border-radius:10px;transition:background .12s,border-color .12s,box-shadow .12s,filter .12s}
.ab-btn:focus-visible,.ab-tab:focus-visible,.ab-switch:focus-visible,.ab-choice:focus-visible,.ab-grp:focus-visible,.ab-find-btn:focus-visible,.ab-ibtn:focus-visible,.ab-aibtn:focus-visible,.ab-chip:focus-visible{outline:none;box-shadow:0 0 0 3px var(--ab-foam-2)}
.ab-btn.primary{box-shadow:0 2px 8px color-mix(in srgb,var(--ab-sea) 30%,transparent)}
.ab-btn.danger:hover{background:rgba(207,34,46,.07);border-color:rgba(207,34,46,.3)}
.ab-switch{width:40px;height:23px}.ab-switch:after{width:17px;height:17px}.ab-switch.on:after{left:20px}
.ab-note{border-radius:12px;padding:11px 14px;line-height:1.6}
.ab-choice{border-radius:14px;padding:12px 14px}
.ab-choice.on b{color:var(--ab-deep)}
.ab-li{padding:11px 4px;border-radius:8px}
.ab-li:hover{background:var(--ab-hover)}
.ab-sticker{border-radius:14px;transition:transform .12s,box-shadow .12s}
.ab-sticker:hover{transform:translateY(-2px);box-shadow:var(--ab-shadow)}
.ab-pitem{border-radius:12px;transition:border-color .12s,box-shadow .12s}
.ab-mood{height:12px}
.ab-mood > i{background:linear-gradient(90deg,#9ad0ff,var(--ab-sea) 60%,#7a6cf0)}
.ab-logs{border-radius:12px;border:1px solid var(--ab-line)}
.ab-log-raw{white-space:pre-wrap;word-break:break-all;padding:2px 10px;border-bottom:1px solid var(--ab-line);content-visibility:auto;contain-intrinsic-size:20px}
.ab-savebar{border-radius:14px;backdrop-filter:blur(8px)}
.ab-table th{font-size:12px;letter-spacing:.02em}
.ab-table tr:hover td{background:var(--ab-hover)}
.ab-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
.ab-check{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:12px;border:1px solid var(--ab-line);background:var(--ab-card-2);color:var(--ab-sub);font-size:12.5px}
.ab-check i{font-style:normal;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:var(--ab-line-2);color:#fff;flex:none}
.ab-check.done{color:var(--ab-text);border-color:color-mix(in srgb,var(--ab-ok) 30%,transparent);background:color-mix(in srgb,var(--ab-ok) 7%,var(--ab-card))}
.ab-check.done i{background:var(--ab-ok)}
.ab-drop{border-radius:14px;background:var(--ab-card-2)}
.ab-drives{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.ab-drive{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;padding:9px 12px;border-radius:12px;border:1px solid var(--ab-line-2);background:var(--ab-card);color:var(--ab-text);font:inherit;cursor:pointer;transition:border-color .12s,box-shadow .12s}
.ab-drive:hover{border-color:var(--ab-sky)}
.ab-drive.on{border-color:var(--ab-sea);box-shadow:0 0 0 3px var(--ab-foam);background:linear-gradient(var(--ab-foam),var(--ab-foam)),var(--ab-card)}
.ab-drive b{font-weight:600}.ab-drive small{color:var(--ab-dim);font-size:11.5px;word-break:break-all}
.ab-drive .bar{display:block;width:100%;height:4px;border-radius:999px;background:var(--ab-card-2);overflow:hidden;margin-top:4px}
.ab-drive .bar i{display:block;height:100%;background:var(--ab-sky)}
.ab-drive.low .bar i{background:var(--ab-warn)}
.ab-install{margin-top:12px;padding:14px 16px;border-radius:14px;border:1px solid var(--ab-foam-2);background:var(--ab-foam)}
.ab-install-steps{display:flex;gap:6px}
.ab-install-steps .st{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11.5px;color:var(--ab-dim);text-align:center;position:relative}
.ab-install-steps .st:before{content:"";position:absolute;top:11px;left:-50%;right:50%;height:2px;background:var(--ab-line-2);z-index:0}
.ab-install-steps .st:first-child:before{display:none}
.ab-install-steps .st.done:before,.ab-install-steps .st.on:before{background:var(--ab-sea)}
.ab-install-steps .st i{position:relative;z-index:1;font-style:normal;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:var(--ab-card);border:2px solid var(--ab-line-2);color:var(--ab-dim)}
.ab-install-steps .st.done i{background:var(--ab-sea);border-color:var(--ab-sea);color:#fff}
.ab-install-steps .st.on i{border-color:var(--ab-sea);color:var(--ab-sea);box-shadow:0 0 0 4px var(--ab-foam-2)}
.ab-install-steps .st.on{color:var(--ab-deep);font-weight:600}
.ab-install-steps .st span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.ab-install-dl{display:flex;flex-wrap:wrap;gap:10px 24px;align-items:center;margin-top:10px}
.ab-install-dl small{display:block;color:var(--ab-dim);font-size:11px}
.ab-install-dl b{font-size:18px;font-variant-numeric:tabular-nums}
@media (max-width:640px){.ab-install-steps .st span{display:none}}
@media (max-width:640px){.ab-row .ab-label{flex:none}.ab-row .ab-label small{max-width:none}}
@media (prefers-reduced-motion:reduce){.ab-root *{transition:none!important;animation:none!important}}
.ab-badge.dim{background:var(--ab-card-2);color:var(--ab-sub);border:1px solid var(--ab-line)}
.ab-badge.warn{background:rgba(191,135,0,.14);color:#9a6700;border:1px solid rgba(191,135,0,.3)}
.ab-badge.err{background:rgba(207,34,46,.1);color:var(--ab-err);border:1px solid rgba(207,34,46,.3)}
.ab-badge.mine{background:var(--ab-deep)}
.ab-mod{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--ab-line)}
.ab-mod:first-child{border-top:0}
.ab-mod .main{flex:1;min-width:0}
.ab-mod .nm{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-weight:600}
.ab-mod .nm code{font-weight:400;font-size:11.5px;color:var(--ab-dim)}
.ab-mod .ds{color:var(--ab-sub);font-size:12.5px;margin-top:2px}
.ab-mod .what{color:var(--ab-dim);font-size:11.5px;margin-top:4px;word-break:break-word}
.ab-mod .acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.ab-mod .side{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
/* 管理功能页：模块项卡片网格（替代原行式布局，提高横向空间利用率）。
   列宽取 180px：DSH 面板内容区偏窄（约 380~450px，还要扣掉所在 Card 的内边距），
   180px 能稳定排出 2 列；容器更窄时由 auto-fill 自动降为单列，无需媒体查询。 */
.ab-manage-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;align-items:stretch}
.ab-manage-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--ab-line);border-radius:12px;background:var(--ab-card);min-width:0}
/* 受限/失败：告警色边框 + 卡底，提示需要处理（色值沿用 .ab-badge.warn 的告警色，不引入新颜色） */
.ab-manage-card.is-blocked{border-color:rgba(191,135,0,.35);background:var(--ab-card-2)}
.ab-manage-card.is-off,.ab-manage-card.is-absent{background:var(--ab-card-2)}
/* 卡片头部：名称+徽标左对齐，启用开关右对齐（两端对齐）。
   width:100% / align-self:stretch 显式撑满卡宽——space-between 只有在头部占满可用宽时
   才会把开关顶到右缘；名称是 auto 宽度的 flex item，靠它撑不满整行。 */
.ab-manage-head{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;align-self:stretch;box-sizing:border-box}
/* 模块名字号：比面板正文(12.5px)/卡片标题(15px)之间取 15.5px，作为卡片内的主标题更醒目 */
.ab-manage-name{font-weight:620;font-size:15.5px;min-width:0;overflow-wrap:anywhere}
.ab-manage-desc{color:var(--ab-sub);font-size:12.5px;line-height:1.55;flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.ab-manage-reason{margin:0;font-size:12.5px}
/* 操作区固定在卡片底部，保证同排卡片按钮对齐 */
.ab-manage-acts{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:auto;padding-top:2px}
/* 卡片内「更多设置（N 项）」子折叠卡：视觉上弱化一层，避免与父卡重复的实底边框 */
.ab-fold-sub{background:transparent;border-style:dashed;box-shadow:none}
/* 组行：一行放一组设置，行内项自由流式排版（按类型与宽度自然排，窄窗自动降列） */
.ab-grp-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px 14px;align-items:start}
.ab-grp-row>.ab-row{flex-direction:column;align-items:flex-start;gap:4px}
.ab-grp-row>.ab-row>.ab-ctl{width:100%}
.ab-code{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--ab-card-2);border:1px solid var(--ab-line);border-radius:8px;padding:8px 10px;white-space:pre-wrap;word-break:break-all;margin:6px 0 0}
`

function useStyle() {
  useEffect(() => {
    if (document.getElementById('aurabot-style')) return
    const el = document.createElement('style')
    el.id = 'aurabot-style'
    el.textContent = CSS
    document.head.appendChild(el)
  }, [])
}

// ---------------- 基础控件 ----------------
// 两种写法都认：内置表单用 on，自己写的模块（panel.js）习惯按受控 input 写 checked。
// 只认 on 的时候，模块面板里的开关会永远显示「关」：on 是 undefined，点了也不变色，
// 看着就像点了没反应（dsh-image 的「用 DSH 已接入的模型生图」就是踩这个坑）。
// label 同理：模块面板习惯写 label，这里当 title 兜住，不至于丢失提示。
function Switch({ on, checked, onChange, disabled, title, label }) {
  const value = on === undefined ? checked : on
  return h('button', { type: 'button', className: cx('ab-switch', value && 'on'), onClick: () => !disabled && onChange(!value), disabled, title: title || label, role: 'switch', 'aria-checked': !!value })
}

function Row({ label, hint, children }) {
  return h('div', { className: 'ab-row' }, h('div', { className: 'ab-label' }, h('b', null, label), hint ? h('small', null, hint) : null), h('div', { className: 'ab-ctl' }, children))
}

function Card({ title, desc, icon, right, children, className, collapsible, defaultOpen = true }) {
  const [open, setOpen] = useState(!collapsible || defaultOpen)
  const head = title ? h('div', { className: 'ab-flex', style: { marginBottom: (desc && open) ? 0 : 10 } },
    h('h3', { onClick: collapsible ? () => setOpen((v) => !v) : undefined, style: collapsible ? { cursor: 'pointer', userSelect: 'none' } : undefined },
      icon || null, title,
      collapsible ? h('span', { className: 'ab-muted', style: { marginLeft: 6, fontSize: 11 } }, open ? '▾ 收起' : '▸ 展开') : null),
    h('div', { className: 'ab-spacer' }), right || null) : null
  return h('div', { className: cx('ab-card', className) }, head, desc && open ? h('p', { className: 'ab-desc' }, desc) : null, open ? children : null)
}

function Btn({ kind, small, onClick, disabled, children, title }) {
  const [busy, setBusy] = useState(false)
  return h('button', {
    type: 'button', title, className: cx('ab-btn', kind, small && 'sm'), disabled: disabled || busy,
    onClick: async () => { if (!onClick) return; setBusy(true); try { await onClick() } finally { setBusy(false) } },
  }, busy ? [h('i', { key: 's', className: 'ab-spin' }), ' 处理中'] : children)
}

/** 自定义下拉：替代系统自带的蓝白 select。options: [{value, label, desc?, group?}] */

let nextSelectId = 0

function Select({ value, options, onChange, placeholder, width, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const [act, setAct] = useState(-1)
  const ref = useRef(null)
  const listId = useRef(null)
  if (!listId.current) listId.current = 'ab-sel-list-' + (++nextSelectId)
  const cur = options.find((o) => o.value === value)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const pick = (o) => { onChange(o.value); setOpen(false) }
  const openAt = () => { setOpen(true); setAct(Math.max(0, options.indexOf(cur))) }
  const onKey = (e) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return openAt()
      setAct((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (open && options[act]) pick(options[act])
      else openAt()
    }
  }
  let lastGroup = null
  const items = []
  options.forEach((o, i) => {
    if (o.group && o.group !== lastGroup) items.push(h('div', { key: 'g' + i, className: 'ab-sel-group' }, o.group))
    lastGroup = o.group || lastGroup
    items.push(h('div', { key: 'o' + i, id: listId.current + '-' + i, role: 'option', 'aria-selected': o.value === value, className: cx('ab-sel-opt', o.value === value && 'on', i === act && 'act'), onMouseEnter: () => setAct(i), onMouseDown: (e) => e.preventDefault(), onClick: () => pick(o) },
      h('span', { className: 'ck' }, o.value === value ? '✓' : ''),
      h('span', { className: 'tx' }, o.label, o.desc ? h('span', { className: 'ds' }, o.desc) : null)))
  })
  return h('div', { className: cx('ab-sel', open && 'open'), ref, style: width ? { minWidth: width } : null, onBlur: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) } },
    h('button', { type: 'button', role: 'combobox', className: 'ab-sel-btn', onClick: () => (open ? setOpen(false) : openAt()), onKeyDown: onKey, 'aria-label': ariaLabel, 'aria-haspopup': 'listbox', 'aria-expanded': open, 'aria-controls': open ? listId.current : undefined, 'aria-activedescendant': open && act >= 0 ? listId.current + '-' + act : undefined },
      h('span', { className: 'v' }, cur ? cur.label : h('span', { className: 'ab-muted' }, placeholder || '请选择')),
      h('svg', { className: 'chev', width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }, h('path', { d: 'M3 4.5 6 7.5 9 4.5' }))),
    open ? h('div', { id: listId.current, className: 'ab-sel-pop', role: 'listbox', 'aria-label': ariaLabel }, items) : null)
}

/** 卡片式单选：选项少、需要解释时用。 */

function Choices({ value, options, onChange }) {
  return h('div', { className: 'ab-choices', role: 'radiogroup' }, options.map((o) => h('button', { key: o.value, type: 'button', role: 'radio', 'aria-checked': o.value === value, className: cx('ab-choice', o.value === value && 'on'), onClick: () => onChange(o.value) },
    h('b', null, o.icon || null, o.label), o.desc ? h('small', null, o.desc) : null)))
}

/** 贴表情的映射表：QQ 系统表情（自己的编号）＋ emoji（Unicode 码点），两种都能直接填给 set_msg_emoji_like。 */
/** QQ 系统表情的预览图：社区维护的 QFace 图库按 id 取 png；取不到就把图藏起来，只留名字。 */

const QFACE_IMG = (id) => 'https://koishi.js.org/QFace/assets/qq_emoji/' + id + '/png/' + id + '.png'

function FaceMapCard() {
  const [data, setData] = useState(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const [copied, setCopied] = useState('')
  useEffect(() => {
    let alive = true
    get('/panel/faces')
      .then((r) => { if (alive && r && r.ok !== false) setData(r) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  const faces = data ? data.faces || [] : []
  const emojis = data ? data.emojis || [] : []
  const all = [
    ...faces.map((x) => ({ kind: 'face', name: String(x.name), id: String(x.id), label: String(x.name) })),
    ...emojis.map((x) => ({ kind: 'emoji', name: String(x.name), id: String(x.id), label: x.char + ' ' + x.name })),
  ]
  const key = String(q || '').trim().toLowerCase()
  const rows = all.filter((x) => (kind === 'all' || x.kind === kind) &&
    (!key || x.name.toLowerCase().includes(key) || x.id.includes(key) || x.label.toLowerCase().includes(key)))
  const copy = (x) => {
    try { navigator.clipboard.writeText(x.id) } catch (e) {}
    setCopied(x.id)
    setTimeout(() => setCopied(''), 1200)
  }
  return h(Card, {
    title: '可用映射' + (all.length ? '（' + all.length + ' 条）' : ''),
    desc: '两种编号混着用都行。点一行复制编号，填进贴表情或让她自己挑。',
  },
    h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' } },
      h(Seg, {
        value: kind,
        options: [
          { value: 'all', label: '全部' },
          { value: 'face', label: 'QQ 表情 ' + faces.length },
          { value: 'emoji', label: 'emoji ' + emojis.length },
        ],
        onChange: setKind,
      }),
      h('input', {
        className: 'ab-input sm',
        placeholder: '搜名字或编号',
        value: q,
        onChange: (e) => setQ(e.target.value),
        style: { width: 180 },
      }),
      copied ? h('span', { className: 'ab-small', style: { color: 'var(--ab-ok)' } }, '已复制 ' + copied) : null),
    data === null
      ? h('div', { className: 'ab-muted ab-small' }, '正在读表情目录…')
      : rows.length === 0
        ? h('div', { className: 'ab-muted ab-small' }, '没有匹配的')
        : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 6, maxHeight: 260, overflow: 'auto', paddingRight: 4 } },
            rows.map((x) => h('button', {
              key: x.kind + x.id,
              type: 'button',
              title: '复制 ' + x.id,
              onClick: () => copy(x),
              style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', font: 'inherit', fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,.22)', background: 'rgba(127,127,127,.06)', color: 'inherit', cursor: 'pointer', textAlign: 'left' },
            },
              h('span', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                x.kind === 'face'
                  ? h('img', {
                      src: QFACE_IMG(x.id), alt: '', width: 18, height: 18, loading: 'lazy',
                      style: { flex: '0 0 auto', width: 18, height: 18, objectFit: 'contain' },
                      onError: (e) => { e.currentTarget.style.visibility = 'hidden' },
                    })
                  : null,
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, x.kind === 'emoji' ? x.label : x.name)),
              h('span', { style: { fontFamily: 'ui-monospace, Consolas, monospace', opacity: 0.75 } }, x.id)))),
  )
}

/** 滑块 + 数值，比纯数字框直观。 */

function Range({ value, min, max, step, onChange, fmt }) {
  return h('div', { className: 'ab-range' },
    h('input', { type: 'range', min, max, step: step || 1, value: value ?? min, onChange: (e) => onChange(Number(e.target.value)) }),
    h('span', { className: 'val' }, fmt ? fmt(value) : value))
}

function Seg({ value, options, onChange, disabled }) {
  return h('div', { className: 'ab-seg' + (disabled ? ' off' : '') }, options.map((o) => h('button', { key: o.value, type: 'button', className: value === o.value ? 'on' : '', disabled: !!disabled, onClick: () => { if (!disabled) onChange(o.value) } }, o.label)))
}

function Empty({ icon, text }) {
  return h('div', { className: 'ab-empty' }, h('div', { className: 'big' }, icon || '🐋'), text)
}

/** 一行一个的列表框：输入时保留原文（含正在敲的空行），只把解析结果交给草稿。 */

function ListArea({ value, onChange, placeholder, numbers }) {
  const parse = (t) => t.split(numbers ? /[\n,，;；\s]+/ : /[\n,，;；]+/).map((s) => s.trim()).filter(Boolean)
  const [text, setText] = useState(value.join('\n'))
  // 外面改了（保存、撤销、重新载入）而且和框里内容对不上时才覆盖
  useEffect(() => { if (parse(text).join('\n') !== value.join('\n')) setText(value.join('\n')) }, [value.join('\n')])
  return h('textarea', { className: 'ab-textarea', style: { minHeight: 60 }, placeholder, value: text,
    onChange: (e) => { setText(e.target.value); onChange(parse(e.target.value)) },
    onBlur: () => setText(parse(text).join('\n')) })
}

// 绑定到草稿配置的控件
// 字段构造器：每个方法都是「key 必填、其余可选」的松散签名，调用点按需给参数。
// 显式标 any，别让 TS 把 (path, props) 推成「两个都必须给」。
function useField(draft, setDraft): any {
  return {
    sw: (path, extra) => h(Switch, { on: !!getPath(draft, path), onChange: (v) => setDraft(setPath(draft, path, v)), ...(extra || {}) }),
    text: (path, props) => h('input', { className: cx('ab-input', props && props.size), value: getPath(draft, path) ?? '', placeholder: props && props.placeholder, type: (props && props.type) || 'text', onChange: (e) => setDraft(setPath(draft, path, e.target.value)) }),
    area: (path, props) => h('textarea', { className: cx('ab-input', props && props.size), rows: (props && props.rows) || 3, spellCheck: false, style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, lineHeight: 1.5, resize: 'vertical' }, value: getPath(draft, path) ?? '', placeholder: props && props.placeholder, onChange: (e) => setDraft(setPath(draft, path, e.target.value)) }),
    num: (path, props) => h('input', { className: 'ab-input sm', type: 'number', min: props && props.min, max: props && props.max, step: (props && props.step) || 1, value: getPath(draft, path) ?? '', onChange: (e) => setDraft(setPath(draft, path, e.target.value === '' ? '' : Number(e.target.value))) }),
    percent: (path) => h(Range, { min: 0, max: 100, value: pct(getPath(draft, path)), onChange: (v) => setDraft(setPath(draft, path, v / 100)), fmt: (v) => v + '%' }),
    // 滑块只是常用范围；超过的值在旁边的框里直接填（概率这种 0~1 的不用）
    range: (path, min, max, step, fmt) => {
      const slider = h(Range, { min, max, step, value: getPath(draft, path), onChange: (v) => setDraft(setPath(draft, path, v)), fmt })
      if (max <= 1) return slider
      return h('div', { className: 'ab-flex' }, slider, h('input', { className: 'ab-input sm', type: 'number', step, value: getPath(draft, path) ?? '', onChange: (e) => setDraft(setPath(draft, path, e.target.value === '' ? '' : Number(e.target.value))) }))
    },
    list: (path, props) => h(ListArea, { value: getPath(draft, path) || [], placeholder: props && props.placeholder, numbers: props && props.numbers, onChange: (v) => setDraft(setPath(draft, path, v)) }),
    select: (path, options, props) => h(Select, { value: getPath(draft, path) ?? '', options, onChange: (v) => setDraft(setPath(draft, path, v)), ...(props || {}) }),
    choices: (path, options) => h(Choices, { value: getPath(draft, path), options, onChange: (v) => setDraft(setPath(draft, path, v)) }),
  }
}

function Fold({ title, summary, icon, children, defaultOpen, right }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return h('div', { className: 'ab-card', style: { marginBottom: 10 } },
    h('div', {
      className: 'ab-flex',
      style: { cursor: 'pointer', userSelect: 'none', alignItems: 'center', gap: 8 },
      onClick: () => setOpen(!open),
    },
      h('span', { style: { fontSize: 13, opacity: 0.7, width: 12, flex: '0 0 auto' } }, open ? '▾' : '▸'),
      h('h3', { style: { margin: 0, fontSize: 15 } }, icon ? h('span', { style: { marginRight: 6 } }, icon) : null, title),
      h('div', { className: 'ab-spacer' }),
      summary ? h('span', { className: 'ab-muted ab-small', style: { textAlign: 'right' } }, summary) : null,
      right ? h('span', { onClick: (e) => e.stopPropagation(), style: { flex: '0 0 auto' } }, right) : null),
    open ? h('div', { style: { marginTop: 12 } }, children) : null)
}

/**
 * 联想预览：输一句 → 走真正的 recall 路径 → 看见「直接命中 / 第几跳 / 从谁联想过来 / 分数打了几折」。
 * 面板「翻一翻」用的是 list()，不经过联想扩散，所以那边看不到跳数，才单独做这个小面板。
 * 后端用 shown:false 调用，预览不会把记忆算成「想起过」（不会偷偷加深）。
 */

function usePersisted(key, initial) {
  const full = 'aurabot.pref.' + key
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(full)
      if (raw === null) return initial
      const parsed = JSON.parse(raw)
      // 类型要和初值一致，否则旧的脏值会让界面崩
      return typeof parsed === typeof initial ? parsed : initial
    } catch (e) { return initial }
  })
  useEffect(() => {
    try { localStorage.setItem(full, JSON.stringify(v)) } catch (e) {}
  }, [v])
  return [v, setV]
}

/**
 * 记忆星图面板。
 * 渲染走 smDraw（原版算法）；这里只负责状态、交互和侧栏清单。
 */

export { h, cx, CSS, useStyle, Switch, Row, Card, Btn, nextSelectId, Select, Choices, QFACE_IMG, FaceMapCard, Range, Seg, Empty, ListArea, useField, Fold, usePersisted }
