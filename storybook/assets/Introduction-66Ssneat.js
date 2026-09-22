import{n as e}from"./iframe-Dy039Pht.js";import{i as t,r as n}from"./react-CfDVPgnt.js";import{a as r,o as i}from"./blocks-CvZRMum6.js";import{n as a}from"./rolldown-runtime-DkW27tQK.js";function o(e){let n={code:`code`,h1:`h1`,h2:`h2`,li:`li`,p:`p`,pre:`pre`,strong:`strong`,ul:`ul`,...t(),...e.components};return(0,c.jsxs)(c.Fragment,{children:[(0,c.jsx)(r,{title:`Docs/Introduction`}),`
`,(0,c.jsx)(n.h1,{id:`design-system`,children:`Design system`}),`
`,(0,c.jsxs)(n.p,{children:[(0,c.jsx)(n.code,{children:`@starter/ui`}),` holds the shared React components and design tokens for every app
in this workspace. Stories default to `,(0,c.jsx)(n.strong,{children:`RTL / Hebrew`}),`; use the `,(0,c.jsx)(n.strong,{children:`Direction`}),`
toolbar button to check a component in LTR as well.`]}),`
`,(0,c.jsx)(n.h2,{id:`using-it-in-an-app`,children:`Using it in an app`}),`
`,(0,c.jsx)(n.pre,{children:(0,c.jsx)(n.code,{className:`language-css`,children:`/* apps/<name>/src/styles.css */
@import '@starter/ui/styles.css';
`})}),`
`,(0,c.jsx)(n.pre,{children:(0,c.jsx)(n.code,{className:`language-tsx`,children:`import { Button } from '@starter/ui';
`})}),`
`,(0,c.jsx)(n.h2,{id:`rules`,children:`Rules`}),`
`,(0,c.jsxs)(n.ul,{children:[`
`,(0,c.jsxs)(n.li,{children:[`Tailwind v4 utilities only; tokens live in `,(0,c.jsx)(n.code,{children:`libs/ui/src/styles.css`}),` (`,(0,c.jsx)(n.code,{children:`@theme`}),`).`]}),`
`,(0,c.jsxs)(n.li,{children:[(0,c.jsx)(n.strong,{children:`Logical properties only`}),`: `,(0,c.jsx)(n.code,{children:`ms-4`}),`, `,(0,c.jsx)(n.code,{children:`pe-2`}),`, `,(0,c.jsx)(n.code,{children:`start-0`}),`, `,(0,c.jsx)(n.code,{children:`text-start`}),`,
`,(0,c.jsx)(n.code,{children:`rounded-s-lg`}),`, `,(0,c.jsx)(n.code,{children:`border-e`}),`. Physical classes (`,(0,c.jsx)(n.code,{children:`ml-4`}),`, `,(0,c.jsx)(n.code,{children:`right-0`}),`,
`,(0,c.jsx)(n.code,{children:`text-left`}),`, ...) fail lint.`]}),`
`,(0,c.jsxs)(n.li,{children:[`Every component ships with a `,(0,c.jsx)(n.code,{children:`*.stories.tsx`}),` and a `,(0,c.jsx)(n.code,{children:`*.spec.tsx`}),` next to it.`]}),`
`,(0,c.jsxs)(n.li,{children:[`Icons that imply direction (arrows, chevrons) must flip: use `,(0,c.jsx)(n.code,{children:`rtl:rotate-180`}),`
or pick the glyph from `,(0,c.jsx)(n.code,{children:`dir`}),`.`]}),`
`]}),`
`,(0,c.jsxs)(n.p,{children:[`See `,(0,c.jsx)(n.code,{children:`docs/`}),` at the repo root for workspace-wide architecture and conventions.`]})]})}function s(e={}){let{wrapper:n}={...t(),...e.components};return n?(0,c.jsx)(n,{...e,children:(0,c.jsx)(o,{...e})}):o(e)}var c;function l(){return(l=a((()=>{c=e(),n(),i()})))()}l();export{s as default};