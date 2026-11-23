import{n as e}from"./rolldown-runtime-sJBDdmOt.js";import{n as t}from"./iframe-B8CVUM0V.js";import{i as n,r}from"./react-88lqOgaf.js";import{a as i,o as a}from"./blocks-DfOC6Vnv.js";function o(e){let t={code:`code`,h1:`h1`,h2:`h2`,li:`li`,p:`p`,pre:`pre`,strong:`strong`,ul:`ul`,...n(),...e.components};return(0,c.jsxs)(c.Fragment,{children:[(0,c.jsx)(i,{title:`Docs/Introduction`}),`
`,(0,c.jsx)(t.h1,{id:`design-system`,children:`Design system`}),`
`,(0,c.jsxs)(t.p,{children:[(0,c.jsx)(t.code,{children:`@starter/ui`}),` holds the shared React components and design tokens for every app
in this workspace. Stories default to `,(0,c.jsx)(t.strong,{children:`RTL / Hebrew`}),`; use the `,(0,c.jsx)(t.strong,{children:`Direction`}),`
toolbar button to check a component in LTR as well.`]}),`
`,(0,c.jsx)(t.h2,{id:`using-it-in-an-app`,children:`Using it in an app`}),`
`,(0,c.jsx)(t.pre,{children:(0,c.jsx)(t.code,{className:`language-css`,children:`/* apps/<name>/src/styles.css */
@import '@starter/ui/styles.css';
`})}),`
`,(0,c.jsx)(t.pre,{children:(0,c.jsx)(t.code,{className:`language-tsx`,children:`import { Button } from '@starter/ui';
`})}),`
`,(0,c.jsx)(t.h2,{id:`rules`,children:`Rules`}),`
`,(0,c.jsxs)(t.ul,{children:[`
`,(0,c.jsxs)(t.li,{children:[`Tailwind v4 utilities only; tokens live in `,(0,c.jsx)(t.code,{children:`libs/ui/src/styles.css`}),` (`,(0,c.jsx)(t.code,{children:`@theme`}),`).`]}),`
`,(0,c.jsxs)(t.li,{children:[(0,c.jsx)(t.strong,{children:`Logical properties only`}),`: `,(0,c.jsx)(t.code,{children:`ms-4`}),`, `,(0,c.jsx)(t.code,{children:`pe-2`}),`, `,(0,c.jsx)(t.code,{children:`start-0`}),`, `,(0,c.jsx)(t.code,{children:`text-start`}),`,
`,(0,c.jsx)(t.code,{children:`rounded-s-lg`}),`, `,(0,c.jsx)(t.code,{children:`border-e`}),`. Physical classes (`,(0,c.jsx)(t.code,{children:`ml-4`}),`, `,(0,c.jsx)(t.code,{children:`right-0`}),`,
`,(0,c.jsx)(t.code,{children:`text-left`}),`, ...) fail lint.`]}),`
`,(0,c.jsxs)(t.li,{children:[`Every component ships with a `,(0,c.jsx)(t.code,{children:`*.stories.tsx`}),` and a `,(0,c.jsx)(t.code,{children:`*.spec.tsx`}),` next to it.`]}),`
`,(0,c.jsxs)(t.li,{children:[`Icons that imply direction (arrows, chevrons) must flip: use `,(0,c.jsx)(t.code,{children:`rtl:rotate-180`}),`
or pick the glyph from `,(0,c.jsx)(t.code,{children:`dir`}),`.`]}),`
`]}),`
`,(0,c.jsxs)(t.p,{children:[`See `,(0,c.jsx)(t.code,{children:`docs/`}),` at the repo root for workspace-wide architecture and conventions.`]})]})}function s(e={}){let{wrapper:t}={...n(),...e.components};return t?(0,c.jsx)(t,{...e,children:(0,c.jsx)(o,{...e})}):o(e)}var c;function l(){return(l=e((()=>{c=t(),r(),a()})))()}l();export{s as default};