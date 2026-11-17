const assert = require('node:assert/strict');
const { load } = require('./test-support/react-hooks.cjs');
const { matchEpisodeSubtitleTracks } = load('lib/media/subtitle-episode-identity.ts');
(async () => {
 const tracks = [
  {src:'english-sdh',language:'eng',filename:'Invincible.2021.S03E08.I.Thought.Youd.Never.Shut.Up.AMZN.WEB.H264-SuccessfulCrab.en[sdh].srt'},
  {src:'spanish',language:'spa',filename:'Invincible.S03E08.I THOUGHT YOU’D NEVER SHUT UP (Español).srt'},
 ];
 for(const title of ["I THOUGHT YOU'D NEVER SHUT UP",'I THOUGHT YOU’D NEVER SHUT UP']) {
  const result = await matchEpisodeSubtitleTracks('tt6741278:3:8',title,tracks,async()=>{throw Error('Exact episode must not need nearby lookup');});
  assert.ok(result.some(track=>track.src==='english-sdh'),'Apostrophe-free release filenames must retain English SDH');
  assert.equal(result.length,2,'Equivalent punctuation cannot filter languages differently');
 }
 const shifted = await matchEpisodeSubtitleTracks('tt123:4:5','The Anecdote',[
  {src:'wrong',filename:'Show.S04E05.Other.Title.srt'},
 ],async()=>[{src:'correct',filename:'Show.S04E04.The.Anecdote.English.SDH.srt'}]);
 assert.equal(shifted[0].src,'correct','Episode title still corrects shifted subtitle numbering');
 console.log('PASS: straight/curly/missing apostrophes preserve English SDH and title-backed episode correction');
})().catch(error=>{console.error(error);process.exitCode=1;});
