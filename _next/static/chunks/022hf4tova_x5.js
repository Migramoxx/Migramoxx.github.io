(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,21033,e=>{"use strict";var t=e.i(43476),a=e.i(71645);let r=a.createContext(null),n=a.createContext(null),o=`
(function(){
  try {
    var stored = localStorage.getItem("mc-theme");
    var dark = stored ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
    var lang = localStorage.getItem("mc-lang");
    if (!lang) lang = (navigator.language || "es").toLowerCase().startsWith("en") ? "en" : "es";
    document.documentElement.setAttribute("lang", lang);
  } catch (e) {}
})();
`;e.s(["SiteProviders",0,function({children:e}){let[o,s]=a.useState("es"),[l,c]=a.useState("light"),[u,i]=a.useState(!1);a.useEffect(()=>{s(localStorage.getItem("mc-lang")||((navigator.language||"es").toLowerCase().startsWith("en")?"en":"es")),c(document.documentElement.classList.contains("dark")?"dark":"light"),i(!0)},[]);let d=a.useCallback(e=>{s(e),localStorage.setItem("mc-lang",e),document.documentElement.setAttribute("lang",e)},[]),m=a.useCallback(()=>{c(e=>{let t="dark"===e?"light":"dark";return document.documentElement.classList.toggle("dark","dark"===t),localStorage.setItem("mc-theme",t),t})},[]),g=a.useCallback(e=>e[o],[o]),h=a.useMemo(()=>({lang:o,setLang:d,t:g,ready:u}),[o,d,g,u]),f=a.useMemo(()=>({theme:l,toggleTheme:m,ready:u}),[l,m,u]);return(0,t.jsx)(r.Provider,{value:h,children:(0,t.jsx)(n.Provider,{value:f,children:e})})},"themeBootstrapScript",0,o,"useLang",0,function(){let e=a.useContext(r);if(!e)throw Error("useLang debe usarse dentro de <SiteProviders>");return e},"useTheme",0,function(){let e=a.useContext(n);if(!e)throw Error("useTheme debe usarse dentro de <SiteProviders>");return e}])},32485,e=>{"use strict";var t=e.i(71645);function a(e,t){try{let a=window;a.umami?.track(e,t)}catch{}}e.s(["AnaliticaEventos",0,function(){return t.useEffect(()=>{1},[]),null}],32485)}]);