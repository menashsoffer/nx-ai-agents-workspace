import{n as e}from"./iframe-NolA4Sdi.js";import{n as t}from"./rolldown-runtime-DkW27tQK.js";function n(...e){return e.flatMap(r).join(` `)}function r(e){return e?typeof e==`string`?[e]:Array.isArray(e)?e.flatMap(r):Object.entries(e).filter(([,e])=>e).map(([e])=>e):[]}function i({variant:e=`primary`,className:t,type:r=`button`,...i}){return(0,a.jsx)(`button`,{type:r,className:n(`inline-flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors`,`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50`,o[e],t),...i})}var a,o;function s(){return(s=t((()=>{a=e(),o={primary:`bg-brand-600 text-white hover:bg-brand-700`,secondary:`bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-100`},i.__docgenInfo={description:``,methods:[],displayName:`Button`,props:{variant:{required:!1,tsType:{name:`union`,raw:`'primary' | 'secondary'`,elements:[{name:`literal`,value:`'primary'`},{name:`literal`,value:`'secondary'`}]},description:``,defaultValue:{value:`'primary'`,computed:!1}},type:{defaultValue:{value:`'button'`,computed:!1},required:!1}},composes:[`ButtonHTMLAttributes`]}})))()}var c,l,u,d,f,p,m;function h(){return(h=t((()=>{s(),c=e(),l={component:i,title:`Components/Button`,args:{children:`לחצו כאן`}},u={},d={args:{variant:`secondary`}},f={args:{children:(0,c.jsxs)(c.Fragment,{children:[(0,c.jsx)(`span`,{"aria-hidden":!0,className:`inline-block rtl:rotate-180`,children:`←`}),`המשך`]})}},p={args:{disabled:!0}},m=[`Primary`,`Secondary`,`WithIcon`,`Disabled`],u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{}`,...u.parameters?.docs?.source}}},d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    variant: 'secondary'
  }
}`,...d.parameters?.docs?.source}}},f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  args: {
    children: <>
        <span aria-hidden className="inline-block rtl:rotate-180">
          ←
        </span>
        המשך
      </>
  }
}`,...f.parameters?.docs?.source}}},p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  args: {
    disabled: true
  }
}`,...p.parameters?.docs?.source}}}})))()}h();export{p as Disabled,u as Primary,d as Secondary,f as WithIcon,m as __namedExportsOrder,l as default};