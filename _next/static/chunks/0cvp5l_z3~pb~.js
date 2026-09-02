(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,21033,e=>{"use strict";var t=e.i(43476),a=e.i(71645);let r=a.createContext(null),o=a.createContext(null),n=`
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
`;e.s(["SiteProviders",0,function({children:e}){let[n,s]=a.useState("es"),[l,c]=a.useState("light"),[u,d]=a.useState(!1);a.useEffect(()=>{s(localStorage.getItem("mc-lang")||((navigator.language||"es").toLowerCase().startsWith("en")?"en":"es")),c(document.documentElement.classList.contains("dark")?"dark":"light"),d(!0)},[]);let i=a.useCallback(e=>{s(e),localStorage.setItem("mc-lang",e),document.documentElement.setAttribute("lang",e)},[]),m=a.useCallback(()=>{c(e=>{let t="dark"===e?"light":"dark";return document.documentElement.classList.toggle("dark","dark"===t),localStorage.setItem("mc-theme",t),t})},[]),g=a.useCallback(e=>e[n],[n]),h=a.useMemo(()=>({lang:n,setLang:i,t:g,ready:u}),[n,i,g,u]),k=a.useMemo(()=>({theme:l,toggleTheme:m,ready:u}),[l,m,u]);return(0,t.jsx)(r.Provider,{value:h,children:(0,t.jsx)(o.Provider,{value:k,children:e})})},"themeBootstrapScript",0,n,"useLang",0,function(){let e=a.useContext(r);if(!e)throw Error("useLang debe usarse dentro de <SiteProviders>");return e},"useTheme",0,function(){let e=a.useContext(o);if(!e)throw Error("useTheme debe usarse dentro de <SiteProviders>");return e}])}]);