export const consoleTheme = `
.ab-root{
  --ab-ink:color-mix(in srgb,var(--ab-text) 83%,#596790);
  --ab-canvas:color-mix(in srgb,var(--ab-bg) 92%,#8399c4);
  --ab-accent-wash:color-mix(in srgb,var(--ab-card) 88%,var(--ab-sea));
  --ab-ease:cubic-bezier(.2,.8,.2,1);
  --ab-shadow:0 1px 3px rgb(31 41 72 / .05);
  background:var(--ab-canvas);color:var(--ab-ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI",system-ui,sans-serif
}
.ab-wrap>.ab-sidebar,.ab-content>.ab-hero,.ab-root .ab-card{
  border:1px solid color-mix(in srgb,var(--ab-sub) 17%,var(--ab-card));border-radius:16px;box-shadow:var(--ab-shadow)
}
.ab-content>.ab-hero{padding:20px 24px;background:linear-gradient(105deg,var(--ab-accent-wash),var(--ab-card) 60%)}
.ab-hero:before{display:none}
.ab-avatar-btn .ab-avatar{display:block;border-radius:24px;border:3px solid var(--ab-card);box-shadow:0 0 0 1px var(--ab-line)}
.ab-avatar-btn,.ab-avatar-btn .ab-avatar-tip{border-radius:24px}
.ab-hero .ab-pill{box-shadow:none}
.ab-directory{grid-template-columns:minmax(0,1fr);gap:16px;padding:16px 10px;line-height:1.4}
.ab-brand{display:flex;align-items:center;gap:10px;padding:0 6px;font-size:18px;font-weight:680;letter-spacing:-.035em}
.ab-brand span{display:grid;place-items:center;background:var(--ab-accent-wash);color:var(--ab-deep);border-radius:12px;width:36px;height:36px}
.ab-directory input.ab-input{box-sizing:border-box;width:100%;min-width:0;background:var(--ab-card-2);border-radius:10px;font:inherit}
.ab-directory section{display:grid;gap:2px}
.ab-directory h2{margin:2px 8px 5px;color:var(--ab-sub);font-weight:600;letter-spacing:.04em}
.ab-directory h2 svg{color:var(--ab-sea)}
.ab-directory [data-group=self] h2 svg,.ab-directory [data-group=express] h2 svg{color:#9774b9}
.ab-directory button{position:relative;display:flex;align-items:center;gap:8px;padding:8px 14px;font-size:13px;line-height:1.4;transition:background .15s,color .15s,transform .15s var(--ab-ease)}
.ab-directory button i{margin-left:auto;flex:none}
.ab-directory button[aria-current=page]{background:var(--ab-accent-wash);color:var(--ab-deep)}
.ab-directory button[aria-current=page]:before{content:"";position:absolute;left:3px;height:14px;width:3px;border-radius:4px;background:var(--ab-sea)}
.ab-directory button:focus-visible,.ab-menu-bar button:focus-visible{outline:2px solid var(--ab-sea);outline-offset:-2px}
.ab-view{min-width:0;animation:ab-view-arrive .23s var(--ab-ease)}
.ab-view-title{margin:2px 2px 12px;color:var(--ab-ink);font-size:19px;font-weight:650;letter-spacing:-.02em}
.ab-root .ab-stat{background:var(--ab-card)}
.ab-stat .ic{display:grid;place-items:center;width:28px;height:28px;border-radius:10px;font-size:16px;background:var(--ab-accent-wash)}
.ab-stat:nth-child(even) .ic{background:color-mix(in srgb,var(--ab-card) 83%,#bea4df)}
.ab-stat .n,.ab-usage-number{color:var(--ab-ink);letter-spacing:-.035em}
.ab-stat .ic svg{width:17px;height:17px;fill:none;stroke:var(--ab-deep);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.ab-root .ab-usage-summary .ab-section-title{margin:0}
.ab-root .ab-card h3:before{height:7px;width:7px;border-radius:50%;background:var(--ab-sea)}
.ab-root .ab-switch:after{left:3px;transition:transform .22s var(--ab-ease)}
.ab-root .ab-switch.on:after{transform:translateX(17px)}
.ab-root .ab-btn,.ab-menu-bar>button{transition:background-color .15s,transform .15s var(--ab-ease)}
.ab-root .ab-btn:active:not(:disabled),.ab-directory button:active,.ab-menu-bar>button:active{transform:scale(.97)}
@keyframes ab-view-arrive{from{opacity:.25;transform:translateY(5px)}to{opacity:1;transform:none}}
@media(max-width:760px){
  .ab-view-title{display:none}
  .ab-menu-bar{gap:10px;border:1px solid var(--ab-line);border-radius:13px;padding:2px 8px;font-weight:600;box-shadow:var(--ab-shadow)}
  .ab-menu-bar>button,.ab-drawer-close{display:grid;place-items:center;width:44px;color:var(--ab-deep)}
  .ab-menu-bar>button svg,.ab-drawer-close svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
  .ab-drawer-close{position:absolute;top:9px;right:8px}
  .ab-drawer .ab-directory{padding:4px 2px 12px}
  .ab-drawer{font-weight:400}
  .ab-drawer{transform:translateX(-100%);border-radius:0 16px 16px 0;transition:transform .24s var(--ab-ease),overlay .24s allow-discrete,display .24s allow-discrete}
  .ab-drawer[open]{transform:none}
  .ab-drawer::backdrop{opacity:0;transition:opacity .22s,overlay .24s allow-discrete,display .24s allow-discrete}
  .ab-drawer[open]::backdrop{opacity:1}
  @starting-style{.ab-drawer[open]{transform:translateX(-100%)}.ab-drawer[open]::backdrop{opacity:0}}
}
@media(max-width:640px){
  .ab-content>.ab-hero{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;padding:16px}
  .ab-hero .ab-avatar{width:54px;height:54px;border-radius:18px}
  .ab-hero-side{grid-column:1/-1;flex-direction:row;justify-content:space-between;border-top:1px solid var(--ab-line);padding-top:10px}
  .ab-hero .ab-pill{white-space:nowrap;padding:2px 7px}
  .ab-grid.ab-g2{grid-template-columns:minmax(0,1fr)}
}
@media(prefers-reduced-motion:reduce){
  .ab-root *::before,.ab-root *::after,.ab-drawer::backdrop{animation:none!important;transition:none!important}
}
`
