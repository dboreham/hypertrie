const Node = require('./node')

var debug = require('debug')('hypertrie:get')

module.exports = Get

function Get (db, key, opts, cb) {
  const hidden = !!(opts && opts.hidden)

  this._db = db
  this._node = new Node({key, hidden}, 0, null)
  this._callback = cb
  this._prefix = !!(opts && opts.prefix)
  this._length = this._node.length - (this._prefix ? 1 : 0)
  this._onnode = (opts && opts.onnode) || null
  this._options = opts ? { wait: opts.wait, timeout: opts.timeout } : null

  debug('get: %O, hash: %O', key, this._node.hash )

  this._start()
}

Get.prototype._start = function () {
  const self = this
  this._db.head(onhead)

  function onhead (err, head) {
    if (err) return self._callback(err, null)
    self._update(0, head)
  }
}

Get.prototype._update = function (i, head) {
  debug('walk:', head.seq)
  if (!head) return this._callback(null, null)

  if (this._onnode) this._onnode(head)
  const node = this._node

  debug('block length: %d, depth: %d', this._length, i)
  debug('trie: %O', head.trie)

  for (; i < this._length; i++) {
    const val = node.path(i)
    const checkCollision = Node.terminator(i)
    debug('pathel: want %d, got %d, col: %s', val, head.path(i), Boolean(checkCollision).toString())

    if (head.path(i) === val) {
      if (!checkCollision || !node.collides(head, i)) {
        debug('skipping level')
        continue
      }
    }

    const bucket = head.trie[i] || []
    debug('chose bucket %d: %O',i, bucket)

    if (checkCollision) return this._updateHeadCollides(i, bucket, val)

    const seq = bucket[val]
    if (!seq) return this._callback(null, null)

    return this._updateHead(i, seq)
  }

  this._callback(null, head.final())
}

Get.prototype._updateHeadCollides = function (i, bucket, val) {
  const self = this
  var missing = 1
  var error = null
  var node = null

  debug('collision')
  for (var j = val; j < bucket.length; j += 5) {
    const seq = bucket[j]
    if (!seq) break
    missing++
    this._db.getBySeq(seq, this._options, onnode)
  }

  onnode(null, null)

  function onnode (err, n) {
    if (err) error = err
    else if (n && !n.collides(self._node, i)) node = n
    if (--missing) return

    if (!node || error) return self._callback(error, null)
    self._update(i + 1, node)
  }
}

Get.prototype._updateHead = function (i, seq) {
  const self = this
  debug('nocollision')
  this._db.getBySeq(seq, this._options, onnode)

  function onnode (err, node) {
    if (err) return self._callback(err, null)
    self._update(i + 1, node)
  }
}
