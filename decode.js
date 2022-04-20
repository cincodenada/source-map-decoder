//
// This Writable steam reads a source map. It will buffer the entire
// input, and once the writable side is closed, it will output the map
// replacing the "mappings" property with human readable content.
//

const { Writable } = require('stream')
const vlq = require('vlq')

class SourceMapDecoder extends Writable {
  constructor (opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = { encoding: 'utf8' }
    }
    if (!cb) throw new Error('new SourceMapDecoder(opts, cb): cb is required')
    super(opts)
    this.input = ''
    if (cb) this.on('finish', () => cb(this.output()))
  }

  _write (chunk, enc, next) {
    this.input += chunk
    next()
  }

  output () {
    try {
      const map = JSON.parse(this.input)
      if (!map.mappings) throw new Error('source map had no "mappings" property')
      if (!Array.isArray(map.sources)) throw new Error('source map had no "sources" property')
      if (!Array.isArray(map.names)) throw new Error('source map had no "names" property')

      const newMappings = (typeof map.mappings === 'string')
        ? decodeMappings(map.mappings, map.sources, map.names)
        : encodeMappings(map.mappings, map.sources, map.names)

      return JSON.stringify({
        ...map,
        mappings: newMappings
      })
    } catch (e) {
      this.emit('error', e)
    }
  }
}

module.exports = SourceMapDecoder

function decodeMappings(mappings, sources, names) {
  const vlqState = [ 0, 0, 0, 0, 0 ]
  return mappings.split(';').reduce((accum, line, i) => {
    accum[i + 1] = decodeLine(line, vlqState, sources, names)
    vlqState[0] = 0
    return accum
  }, {})
}

function decodeLine(line, state, sources, names) {
  const segs = line.split(',')
  return segs.map(seg => {
    if (!seg) return ''
    const decoded = vlq.decode(seg)
    for (var i = 0; i < 5; i++) {
      state[i] = typeof decoded[i] === 'number' ? state[i] + decoded[i] : state[i]
    }
    return decodeSegment(...state.concat([ sources, names ]))
  })
}

function decodeSegment(col, source, sourceLine, sourceCol, name, sources, names) {
  return `${col + 1} => ${sources[source]} ${sourceLine + 1}:${sourceCol + 1}${names[name] ? ` ${names[name]}` : ``}`
}

function encodeMappings(mappings, sources) {
  const vlqState = Array(4).fill(0)
  return Object.values(mappings).map(line => encodeLine(line, vlqState, sources)).join(';')
}

function encodeLine(line, sources, state) {
  return line.map(seg => encodeSegment(seg, sources, state)).join(',')
}

function encodeSegment(segment, sources, state) {
  // TODO: Deal with names
  let parts = segment.split(' ')
  const mapCol = parts[0]
  const filename = parts.slice(2,-2).join(' ')
  const [sourceLine, sourceCol] = parts[parts.length-1].split(':')

  const sourceIdx = sources.indexOf(filename)
  const values = [mapCol-1, sourceIdx, sourceLine-1, sourceCol-1]
  const relativeValues = values.map((val, idx) => {
    const diff = val - state[idx];
    state[idx] = val;
    return diff
  })
  return vlq.encode(relativeValues)
}
