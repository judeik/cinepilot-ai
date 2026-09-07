export class RunStore { constructor(){this.runs=new Map()} set(id,value){this.runs.set(id,value)} get(id){return this.runs.get(id)} }
