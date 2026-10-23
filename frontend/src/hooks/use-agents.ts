"use client";
import {useEffect,useRef,useState} from "react";
/** Clears old-scope data during render and ignores aborted/late responses. */
export function useAgentRequest<T>(key:string,load:(signal:AbortSignal)=>Promise<T>){
  const loader=useRef(load);loader.current=load;
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState<{key:string;data?:T;error?:string;loading:boolean}>({key,loading:!!key});
  useEffect(()=>{const abort=new AbortController();setState({key,loading:!!key});if(key)void loader.current(abort.signal).then(data=>{if(!abort.signal.aborted)setState({key,data,loading:false});}).catch((e:unknown)=>{if(!abort.signal.aborted)setState({key,error:e instanceof Error?e.message:"Unable to load",loading:false});});return()=>abort.abort();},[key,attempt]);
  return {...(state.key===key?state:{key,loading:!!key}),retry:()=>setAttempt(n=>n+1)};
}
