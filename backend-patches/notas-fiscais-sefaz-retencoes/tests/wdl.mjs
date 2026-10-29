// Interpretador de teste do subconjunto WDL usado pelas expressoes geradas.
// Executa as expressoes reais com entradas ficticias; nao faz chamadas Microsoft.
export function evaluate(text,context={}){
  if(typeof text!=='string'||!text.startsWith('@'))return text;
  let pos=1;
  const ws=()=>{while(/\s/.test(text[pos]??'')&&pos<text.length)pos++;};
  function parse(){
    ws();let value;
    if(text[pos]==="'"){
      pos++;value='';let closed=false;
      while(pos<text.length){
        if(text[pos]==="'"){
          if(text[pos+1]==="'"){value+="'";pos+=2;continue;}
          pos++;closed=true;break;
        }
        value+=text[pos++];
      }
      if(!closed)throw new Error(`String WDL incompleta: ${text}`);
    }else{
      const match=/^[A-Za-z_][A-Za-z_0-9]*|^-?\d+/.exec(text.slice(pos));
      if(!match)throw new Error(`Token WDL invalido em ${pos}: ${text}`);
      const name=match[0];pos+=name.length;ws();
      if(text[pos]==='('){
        pos++;const args=[];ws();
        if(text[pos]!==')')while(true){args.push(parse());ws();if(text[pos]!==',')break;pos++;}
        if(text[pos++]!==')')throw new Error(`Parenteses WDL em ${pos}: ${text}`);
        const funcs={
          outputs:n=>context.outputs?.[n],body:n=>context.body?.[n],items:n=>context.items?.[n],parameters:n=>context.parameters?.[n],variables:n=>context.variables?.[n],
          concat:(...a)=>a.join(''),string:v=>typeof v==='string'?v:JSON.stringify(v),json:JSON.parse,
          equals:(a,b)=>a===b,not:a=>!a,and:(...a)=>a.every(Boolean),greater:(a,b)=>a>b,
          int:v=>Number(v),length:v=>v.length,empty:v=>v==null||(Array.isArray(v)||typeof v==='string'?v.length===0:Object.keys(v).length===0),
          if:(a,b,c)=>a?b:c,coalesce:(...a)=>a.find(v=>v!==null&&v!==undefined)??null,
          first:a=>a?.[0]??null,createArray:(...a)=>a,setProperty:(o,k,v)=>({...o,[k]:v}),
          substring:(value,start,length)=>length===undefined?value.substring(start):value.substring(start,start+length),
          base64:v=>Buffer.from(v,'utf8').toString('base64'),base64ToBinary:v=>Buffer.from(v,'base64'),
        };
        if(!funcs[name])throw new Error(`Funcao WDL nao coberta pelo teste: ${name}`);
        value=funcs[name](...args);
      }else if(name==='true'||name==='false'){value=name==='true';}
      else if(name==='null'){value=null;}
      else if(/^-?\d+$/.test(name)){value=Number(name);}
      else throw new Error(`Identificador inesperado ${name}`);
    }
    ws();
    while(text[pos]==='?'||text[pos]==='['){
      if(text[pos]==='?')pos++;
      if(text[pos++]!=='[')throw new Error('Esperado [');
      const key=parse();ws();if(text[pos++]!==']')throw new Error('Esperado ]');
      value=value?.[key]??null;ws();
    }
    return value;
  }
  const value=parse();ws();if(pos!==text.length)throw new Error(`Sufixo WDL invalido em ${pos}: ${text}`);
  return value;
}
