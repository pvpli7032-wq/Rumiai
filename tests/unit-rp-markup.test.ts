/**
 * Unit cover for the roleplay markup parser. This is a pure function, so unlike the rest
 * of the suite it needs no server — but it is the one piece every message passes through,
 * and the streaming cases are the ones that would be invisible in an opaque-box test.
 */

import { describe, test, assertOk, assertEquals } from './helpers/test-runner';
import { parseRoleplay, plainText, spokenText } from '../src/lib/rp-markup';
import { buildSystemPrompt, mockBeat } from '../src/lib/conversations/chat-stream';

export function registerRoleplayMarkupTests() {
  describe('Unit - Roleplay markup', () => {
    test('M.1 Narration and dialogue split apart', async () => {
      const nodes = parseRoleplay('*เขายืนพิงกำแพง* "กลับดึกจังนะ"');
      assertEquals(nodes.length, 3);
      assertEquals(nodes[0].type, 'narration');
      assertEquals(nodes[0].value, 'เขายืนพิงกำแพง');
      assertEquals(nodes[1].type, 'text');
      assertEquals(nodes[2].type, 'speech');
      assertEquals(nodes[2].value, 'กลับดึกจังนะ');
    });

    test('M.2 The site\'s richer markup is recognised', async () => {
      const nodes = parseRoleplay('/grad{สำคัญ}/ และ /underline{ขีดเส้นใต้}/');
      assertEquals(nodes[0].type, 'gradient');
      assertEquals(nodes[0].value, 'สำคัญ');
      assertEquals(nodes[2].type, 'underline');
      assertEquals(nodes[2].value, 'ขีดเส้นใต้');
    });

    test('M.3 An inner thought drops its marker', async () => {
      const nodes = parseRoleplay('[💭 เขาคิดในใจว่าไม่ควรพูด]');
      assertEquals(nodes.length, 1);
      assertEquals(nodes[0].type, 'thought');
      assertEquals(nodes[0].value, 'เขาคิดในใจว่าไม่ควรพูด');
    });

    test('M.4 An unclosed marker stays literal instead of swallowing the rest', async () => {
      // This is the streaming case: a reply arrives a token at a time, so half-written
      // markup is the normal state. Consuming to end-of-string would make the text
      // reflow on every chunk as the closing marker lands.
      const partial = parseRoleplay('*เขายืนพิงกำ');
      assertEquals(partial.length, 1);
      assertEquals(partial[0].type, 'text');
      assertEquals(partial[0].value, '*เขายืนพิงกำ');

      // And once the marker closes, the same text parses as narration.
      const complete = parseRoleplay('*เขายืนพิงกำแพง*');
      assertEquals(complete[0].type, 'narration');
    });

    test('M.5 Empty pairs are punctuation, not markup', async () => {
      for (const input of ['**', '""', '/grad{}/']) {
        const nodes = parseRoleplay(input);
        assertOk(
          nodes.every((n) => n.type === 'text'),
          `${input} must stay literal`
        );
      }
    });

    test('M.6 Plain text keeps only the words', async () => {
      assertEquals(plainText('*ยืนพิงกำแพง* "สวัสดี"'), 'ยืนพิงกำแพง สวัสดี');
    });

    test('M.7 Speech synthesis skips inner thoughts', async () => {
      // A thought is what the prose is deliberately withholding; reading it aloud would
      // give it away.
      const spoken = spokenText('*ยิ้ม* "สบายดีไหม" [💭 จริงๆ ไม่อยากเจอเลย]');
      assertOk(!spoken.includes('ไม่อยากเจอ'), 'the thought must not be spoken');
      assertOk(spoken.includes('สบายดีไหม'), 'the dialogue must be spoken');
    });

    test('M.9 The system prompt carries the scenario and the role guidance', async () => {
      // These two were absent from the prompt while the detail dialog showed the scenario
      // to the reader, so the reader could see a setup the character had never been told.
      const prompt = buildSystemPrompt({
        name: 'อลัน',
        personality: 'กวน ปากจัด',
        background: 'รูมเมทปี 4',
        scenario: 'คืนหลังงานเลี้ยงรุ่น',
        roleTemplate: 'เล่นเป็นสองคนสลับกัน',
      });
      assertOk(prompt.includes('อลัน'), 'the name must be present');
      assertOk(prompt.includes('กวน ปากจัด'), 'the personality must be present');
      assertOk(prompt.includes('รูมเมทปี 4'), 'the background must be present');
      assertOk(prompt.includes('คืนหลังงานเลี้ยงรุ่น'), 'the scenario must reach the model');
      assertOk(prompt.includes('เล่นเป็นสองคนสลับกัน'), 'the role guidance must reach the model');
      assertOk(prompt.includes('用户询问身份时应诚实说明'), 'the standing instruction must survive');
      assertOk(prompt.includes('保持角色一致'), 'staying in character must be asked for');
      assertOk(prompt.includes('*星号*'), 'the app’s narration style must be asked for');
    });

    test('M.11 Adult latitude is opt-in per character, and the hard limits are explicit', async () => {
      const base = { name: 'ก', personality: 'ข' };

      const ordinary = buildSystemPrompt(base);
      assertOk(!ordinary.includes('18+'), 'a character not marked adult gets no adult direction');

      const adult = buildSystemPrompt({ ...base, isAdult: true });
      assertOk(adult.includes('18+'), 'an adult character is not artificially coy');
      // These stay stated rather than implicit; the moderation taxonomy exists because
      // these cases are real, and the upstream provider enforces its own policy too.
      assertOk(adult.includes('未成年人'), 'the limit on minors must be explicit');
      assertOk(adult.includes('真实人物'), 'the limit on real people must be explicit');
      assertOk(adult.includes('未经同意'), 'the limit on non-consent must be explicit');
    });

    test('M.10 Missing parts are dropped, not interpolated as null', async () => {
      // The template used to interpolate `${character.background}` unconditionally, which
      // put the literal text "null" into the prompt for every character without one.
      const prompt = buildSystemPrompt({
        name: 'มะนาว',
        personality: 'ใจดี',
        background: null,
        scenario: null,
        roleTemplate: '   ',
      });
      assertOk(!prompt.includes('null'), 'no literal null may reach the model');
      assertOk(!prompt.includes('undefined'), 'no literal undefined may reach the model');
      assertOk(!prompt.includes('当前场景：'), 'an absent scenario adds no empty heading');
      assertOk(!prompt.includes('角色指引：'), 'whitespace-only guidance is treated as absent');
      assertOk(prompt.includes('มะนาว') && prompt.includes('ใจดี'), 'what exists is still present');
    });

    test('M.12 The fallback line stays in character', async () => {
      // When every model in the chain fails, the reply used to be one of seven chirpy
      // assistant lines served regardless of who the character was — breaking the role at
      // exactly the moment a reader is most likely to notice.
      const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
      for (let i = 0; i < 20; i++) {
        const beat = mockBeat('ไทเป');
        assertOk(beat.includes('ไทเป'), 'the fallback names the character');
        assertOk(beat.includes('*'), 'it is written as stage direction');
        assertOk(!/AI|ผู้ช่วย|assistant/i.test(beat), 'it never breaks the fourth wall');
        assertOk(!emoji.test(beat), 'no assistant-voice emoji');
        assertOk(!/ดีใจมากที่ได้คุย/.test(beat), 'not the old greeting script');
      }
    });

    test('M.8 Ordinary text passes through untouched', async () => {
      const nodes = parseRoleplay('ข้อความธรรมดาไม่มีมาร์กอัป');
      assertEquals(nodes.length, 1);
      assertEquals(nodes[0].type, 'text');
      assertEquals(nodes[0].value, 'ข้อความธรรมดาไม่มีมาร์กอัป');
    });
  });
}
