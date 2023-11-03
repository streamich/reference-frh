// Run with:
// $ node dist/simple/fuzzer.js

import { SimpleListOpLog, ListOpType, createSimpleOpLog, mergeOplogInto } from './oplog.js'
import { checkoutSimple } from './merge.js'

import * as causalGraph from "../causal-graph.js";
import { RawVersion } from '../types.js'

import seedRandom from 'seed-random'
import assert from 'node:assert/strict'
import consoleLib from 'console'

interface Doc {
  oplog: SimpleListOpLog<number>,
  content: number[],
}

const createDoc = (): Doc => {
  return { oplog: createSimpleOpLog(), content: [] }
}

const docInsert = (doc: Doc, [agent, seq]: RawVersion, pos: number, content: number) => {
  // I'm not using the oplog localInsert function in order to control the sequence number we use.
  // localInsert(doc.oplog, doc.agent, pos, content)
  causalGraph.add(doc.oplog.cg, agent, seq, seq+1, doc.oplog.cg.heads)
  doc.oplog.ops.push({ type: ListOpType.Ins, pos, content })

  doc.content.splice(pos, 0, content)
}

const docDelete = (doc: Doc, [agent, seq]: RawVersion, pos: number, len: number) => {
  if (len === 0) throw Error('Invalid delete length')

  causalGraph.add(doc.oplog.cg, agent, seq, seq+len, doc.oplog.cg.heads)
  for (let i = 0; i < len; i++) {
    doc.oplog.ops.push({ type: ListOpType.Del, pos })
  }
  doc.content.splice(pos, len)
}

const docCheck = (doc: Doc) => {
  causalGraph.checkCG(doc.oplog.cg)
  const expectedContent = checkoutSimple(doc.oplog)
  assert.deepEqual(expectedContent, doc.content)
}

const docMergeInto = (dest: Doc, src: Doc) => {
  mergeOplogInto(dest.oplog, src.oplog)
  dest.content = checkoutSimple(dest.oplog)
}

const consumeSeqs = (rv: RawVersion, num = 1): RawVersion => {
  let result: RawVersion = [rv[0], rv[1]]
  rv[1] += num
  return result
}

function fuzzer(seed: number) {
  globalThis.console = new consoleLib.Console({
    stdout: process.stdout, stderr: process.stderr,
    inspectOptions: {depth: null}
  })

  const random = seedRandom(`zz ${seed}`)
  const randInt = (n: number) => Math.floor(random() * n)
  const randBool = (weight: number = 0.5) => random() < weight

  const docs = [createDoc(), createDoc(), createDoc()]
  const agents: RawVersion[] = [['a', 0], ['b', 0], ['c', 0]]
  const randDoc = () => docs[randInt(docs.length)]

  let nextItem = 0

  for (let i = 0; i < 100; i++) {
    // console.log('i', i)
    // Generate some random operations
    for (let j = 0; j < 3; j++) {
      const doc = randDoc()

      const len = doc.content.length
      const insWeight = len < 100 ? 0.6 : 0.4
      let agent = agents[randInt(agents.length)]

      if (len === 0 || randBool(insWeight)) {
        // Insert!
        const content = ++nextItem
        let pos = randInt(len + 1)
        docInsert(doc, consumeSeqs(agent, 1), pos, content)
      } else {
        const pos = randInt(len)
        const delLen = randInt(Math.min(len - pos, 3)) + 1
        // console.log('delete', pos, delLen)
        docDelete(doc, consumeSeqs(agent, delLen), pos, delLen)
      }

      docCheck(doc) // EXPENSIVE
    }

    // Pick a random pair of documents and merge them
    const a = randDoc()
    const b = randDoc()
    if (a !== b) {
      // console.log('a', a, 'b', b)

      docMergeInto(a, b)
      // console.log(a)
      // debugger
      docMergeInto(b, a)
      // console.log(b)
      // console.log('a', a.content, 'b', b.content)
      // console.log('a', a, 'b', b)
      assert.deepEqual(a.content, b.content)
    }
  }
}

function fuzzLots() {
  for (let i = 0; i < 100000; i++) {
    if (i % 10 === 0) console.log('i', i)
    try {
      fuzzer(i)
    } catch (e) {
      console.log('in seed', i)
      throw e
    }
  }
}

// fuzzer(Number(process.env['SEED']) ?? 0)
// fuzzer(3)
fuzzLots()