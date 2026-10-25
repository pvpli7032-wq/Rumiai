export function encodePcmWav(chunks:Float32Array[],sampleRate:number):File {
 const samples=chunks.reduce((count,chunk)=>count+chunk.length,0),buffer=new ArrayBuffer(44+samples*2),view=new DataView(buffer);
 const word=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
 word(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,samples*2,true);
 let offset=44;for(const chunk of chunks)for(const value of chunk){const sample=Math.max(-1,Math.min(1,value));view.setInt16(offset,sample<0?sample*32768:sample*32767,true);offset+=2;}
 return new File([buffer],'recording.wav',{type:'audio/wav'});
}
