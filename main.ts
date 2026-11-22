// tiny stack VM (ISA v1) for tiny-stack-vm-01-run-20261122.
// MAKEFUN_INPUT_DIR/<id>/{program.bin,input.bin} -> MAKEFUN_OUTPUT_DIR/<id>/{stdout.bin,exit.txt}
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function rd(p) {
  try { return readFileSync(p); } catch { return Buffer.alloc(0); }
}

// immediate length per opcode (missing key = unknown opcode)
const IMM = { 0:0, 1:1, 2:4, 3:0, 4:0, 5:0, 6:0, 7:0, 16:0, 17:0, 18:0, 19:0, 20:0, 21:0, 22:0, 23:0, 24:0, 25:0, 26:0, 27:0, 28:0, 29:0, 30:0, 32:0, 33:0, 34:0, 48:2, 49:2, 50:2, 51:2, 52:0, 64:0, 65:0, 80:0, 81:0, 82:0, 83:0 };
// stack pops / pushes per opcode (trap 2 / trap 3)
const POPS = { 3:1, 4:1, 5:2, 6:2, 7:3, 16:2, 17:2, 18:2, 19:2, 20:2, 21:2, 22:2, 23:1, 24:2, 25:2, 26:2, 27:1, 28:2, 29:2, 30:2, 32:2, 33:2, 34:2, 49:1, 50:1, 64:1, 65:2, 80:1, 81:1, 83:1 };
const PUSHES = { 1:1, 2:1, 4:2, 5:2, 6:3, 7:3, 16:1, 17:1, 18:1, 19:1, 20:1, 21:1, 22:1, 23:1, 24:1, 25:1, 26:1, 27:1, 28:1, 29:1, 30:1, 32:1, 33:1, 34:1, 64:1, 82:1 };

function run(prog, input) {
  const st = []; // data stack (signed 32-bit)
  const cs = []; // call stack
  const mem = new Int32Array(256);
  const chunks = [];
  let outLen = 0, pc = 0, steps = 0, inPos = 0;
  const fin = (code) => ({ out: Buffer.concat(chunks, outLen), code });

  while (true) {
    if (steps >= 1000000) return fin(10);
    if (pc < 0 || pc >= prog.length) return fin(9);
    const op = prog[pc];
    const imm = IMM[op];
    if (imm === undefined) return fin(5);
    if (pc + 1 + imm > prog.length) return fin(9);
    steps++;
    const pops = POPS[op] ?? 0, pushes = PUSHES[op] ?? 0;
    if (st.length < pops) return fin(2);
    if (st.length - pops + pushes > 256) return fin(3);
    const next = pc + 1 + imm;
    const rel = () => ((prog[pc + 1] | (prog[pc + 2] << 8)) << 16) >> 16;

    switch (op) {
      case 0: return fin(0); // HALT
      case 1: st.push((prog[pc + 1] << 24) >> 24); pc = next; break; // PUSH8
      case 2: st.push(prog[pc + 1] | (prog[pc + 2] << 8) | (prog[pc + 3] << 16) | (prog[pc + 4] << 24)); pc = next; break; // PUSH32
      case 3: st.pop(); pc = next; break; // POP
      case 4: st.push(st[st.length - 1]); pc = next; break; // DUP
      case 5: { const b = st.pop(), a = st.pop(); st.push(b, a); pc = next; break; } // SWAP
      case 6: st.push(st[st.length - 2]); pc = next; break; // OVER
      case 7: { const c = st.pop(), b = st.pop(), a = st.pop(); st.push(b, c, a); pc = next; break; } // ROT
      case 23: st[st.length - 1] = -st[st.length - 1] | 0; pc = next; break; // NEG
      case 27: st[st.length - 1] = ~st[st.length - 1]; pc = next; break; // NOT
      case 48: pc = next + rel(); break; // JMP
      case 49: pc = st.pop() === 0 ? next + rel() : next; break; // JZ
      case 50: pc = st.pop() !== 0 ? next + rel() : next; break; // JNZ
      case 51: // CALL (unsigned target)
        if (cs.length >= 64) return fin(7);
        cs.push(next);
        pc = prog[pc + 1] | (prog[pc + 2] << 8);
        break;
      case 52: // RET
        if (cs.length === 0) return fin(8);
        pc = cs.pop();
        break;
      case 64: { // LOAD
        const addr = st[st.length - 1];
        if (addr < 0 || addr > 255) return fin(6);
        st[st.length - 1] = mem[addr];
        pc = next;
        break;
      }
      case 65: { // STORE (addr on top)
        const addr = st.pop(), v = st.pop();
        if (addr < 0 || addr > 255) return fin(6);
        mem[addr] = v;
        pc = next;
        break;
      }
      case 80: { // PRINT (all-or-nothing vs output cap)
        const s = String(st.pop());
        if (outLen + s.length > 65536) return fin(11);
        chunks.push(Buffer.from(s, 'ascii'));
        outLen += s.length;
        pc = next;
        break;
      }
      case 81: { // PUTC
        const v = st.pop();
        if (outLen + 1 > 65536) return fin(11);
        chunks.push(Buffer.from([v & 255]));
        outLen += 1;
        pc = next;
        break;
      }
      case 82: st.push(inPos < input.length ? input[inPos++] : -1); pc = next; break; // IN
      case 83: return fin(st.pop() & 255); // EXIT
      default: { // binary ops
        const b = st.pop(), a = st.pop();
        let r;
        switch (op) {
          case 16: r = (a + b) | 0; break;
          case 17: r = (a - b) | 0; break;
          case 18: r = Math.imul(a, b); break;
          case 19: if (b === 0) return fin(4); r = Math.trunc(a / b) | 0; break;
          case 20: if (b === 0) return fin(4); r = (a % b) | 0; break;
          case 21: if (b === 0) return fin(4); r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break;
          case 22: if (b === 0) return fin(4); r = ((a >>> 0) % (b >>> 0)) | 0; break;
          case 24: r = a & b; break;
          case 25: r = a | b; break;
          case 26: r = a ^ b; break;
          case 28: r = a << (b & 31); break;
          case 29: r = a >> (b & 31); break;
          case 30: r = (a >>> (b & 31)) | 0; break;
          case 32: r = a === b ? 1 : 0; break;
          case 33: r = a < b ? 1 : 0; break;
          case 34: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
          default: return fin(5);
        }
        st.push(r);
        pc = next;
        break;
      }
    }
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  const { out, code } = run(rd(join(IN_DIR, id, 'program.bin')), rd(join(IN_DIR, id, 'input.bin')));
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'stdout.bin'), out);
  writeFileSync(join(OUT_DIR, id, 'exit.txt'), `${code}\n`);
}
