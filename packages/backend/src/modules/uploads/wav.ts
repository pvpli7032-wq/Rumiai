/** PCM WAV only: decoded duration is derived from the stored bytes, never client metadata. */
export function readWavDurationMs(bytes:Buffer):number {
 if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('WAV文件结构无效。');
 let offset=12,rate=0,alignment=0,dataBytes=0,format=false;
 while(offset+8<=bytes.length){const tag=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8;if(start+size>bytes.length)throw Error('WAV文件不完整。');
 if(tag==='fmt '){if(format||size<16)throw Error('WAV编码无效。');const code=bytes.readUInt16LE(start),channels=bytes.readUInt16LE(start+2),sampleRate=bytes.readUInt32LE(start+4),byteRate=bytes.readUInt32LE(start+8),block=bytes.readUInt16LE(start+12),bits=bytes.readUInt16LE(start+14);if(code!==1||![1,2].includes(channels)||bits!==16||sampleRate<8000||sampleRate>96000||block!==channels*2||byteRate!==sampleRate*block)throw Error('仅支持16位PCM WAV录音。');format=true;rate=byteRate;alignment=block;}
 if(tag==='data')dataBytes+=size;offset=start+size+(size%2);}
 if(!format||!dataBytes||dataBytes%alignment||offset!==bytes.length)throw Error('WAV录音内容无效。');return Math.ceil(dataBytes/rate*1000);
}
