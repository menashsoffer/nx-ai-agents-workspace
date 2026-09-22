import{n as e}from"./iframe-Dy039Pht.js";import{n as t}from"./rolldown-runtime-DkW27tQK.js";function n(...e){return e.filter(Boolean).join(` `)}function r({variant:e=`primary`,className:t,type:r=`button`,...o}){return(0,i.jsx)(`button`,{type:r,className:n(`inline-flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors`,`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50`,a[e],t),...o})}var i,a;function o(){return(o=t((()=>{i=e(),a={primary:`bg-brand-600 text-white hover:bg-brand-700`,secondary:`bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-100`},r.__docgenInfo={description:``,methods:[],displayName:`Button`,props:{variant:{required:!1,tsType:{name:`union`,raw:`'primary' | 'secondary'`,elements:[{name:`literal`,value:`'primary'`},{name:`literal`,value:`'secondary'`}]},description:``,defaultValue:{value:`'primary'`,computed:!1}},type:{defaultValue:{value:`'button'`,computed:!1},required:!1}},composes:[`ButtonHTMLAttributes`]}})))()}var s,c,l,u,d,f,p;function m(){return(m=t((()=>{o(),s=e(),c={component:r,title:`Components/Button`,args:{children:`לחצו כאן`}},l={},u={args:{variant:`secondary`}},d={args:{children:(0,s.jsxs)(s.Fragment,{children:[(0,s.jsx)(`span`,{"aria-hidden":!0,children:`←`}),`המשך`]})}},f={args:{disabled:!0}},p=[`Primary`,`Secondary`,`WithIcon`,`Disabled`],l.parameters={...l.parameters,docs:{...l.parameters?.docs,source:{originalSource:`{}`,...l.parameters?.docs?.source}}},u.parameters={...u.parameters,docs:{...u.parameters?.docs,source:{originalSource:`{
  args: {
    variant: 'secondary'
  }
}`,...u.parameters?.docs?.source}}},d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  args: {
    children: <>
        <span aria-hidden>←</span>
        המשך
      </>
  }
}`,...d.parameters?.docs?.source}}},f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  args: {
    disabled: true
  }
}`,...f.parameters?.docs?.source}}}})))()}m();export{f as Disabled,l as Primary,u as Secondary,d as WithIcon,p as __namedExportsOrder,c as default};