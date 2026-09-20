/*!
 * write <https://github.com/jonschlinkert/write>
 *
 * Copyright (c) 2014-present, Jon Schlinkert.
 * Licensed under the MIT License.
 */

'use strict';

require('mocha');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const assert = require('assert').strict;
const rimraf = require('rimraf');
const write = require('..');
const tmp = path.resolve.bind(path, __dirname, 'fixtures');
const files = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'].map(n => tmp(n));

const toStream = str => {
  let stream = new Readable();
  stream.push(str);
  stream.push(null);
  return stream;
};

describe('write', () => {
  afterEach(cb => {
    rimraf(tmp(), { glob: false }, cb);
  });

  describe('async', () => {
    it('should write files', async () => {
      for (let file of files) {
        await write(file, 'content...');
        assert(fs.existsSync(file));
      }
    });

    it('should not overwrite files when specified', async () => {
      for (let file of files) {
        write.sync(file, 'content...');
        await assert.rejects(async () => {
          return write(file, 'content...', { overwrite: false });
        });
      }
    });

    it('should automatically rename files to avoid conflicts', async () => {
      for (let file of files) {
        write.sync(file, 'content...');
        const result = await write(file, 'content...', { increment: true });
        assert.notEqual(file, result.path);
        assert(fs.existsSync(result.path));
      }
    });

    it('should take a callback', cb => {
      let fp = tmp('a.txt');
      write(fp, 'content...', err => {
        if (err) {
          cb(err);
          return;
        }
        assert(fs.existsSync(fp));
        cb();
      });
    });

    it('should just write given data by default', cb => {
      write(tmp('a.txt'), 'Hello!', err => {
        if (err) {
          cb(err);
          return;
        }

        fs.readFile(tmp('a.txt'), (err, buf) => {
          if (err) {
            cb(err);
          }
          assert.equal('Hello!', buf.toString());
          cb();
        });
      });
    });

    it('should add a new line at the end of the file if none', async() => {
      for (let file of files) {
        await write(file, 'Hello!', { newline: true });
        let contents = fs.readFileSync(file, 'utf8');
        assert.equal('Hello!\n', contents.toString());
      }
    });

    it('should serialize concurrent writes to the same filepath', async() => {
      const fp = tmp('race.txt');
      // A larger first write and a smaller second write reproduces #13
      // without 100MB buffers: without a queue the smaller write finishes
      // first, then the large write overwrites (or tears) the file.
      const first = Buffer.alloc(2 * 1024 * 1024, 0x61);
      const second = Buffer.alloc(64 * 1024, 0x62);
      let contentsAfterFirst;

      const started = write(fp, first, { overwrite: true }).then(result => {
        contentsAfterFirst = fs.readFileSync(fp);
        return result;
      });
      const queuedLast = write(fp, second, { overwrite: true });

      await Promise.all([started, queuedLast]);

      assert.ok(contentsAfterFirst.equals(first), 'each write finishes completely before the next starts');
      assert.ok(fs.readFileSync(fp).equals(second), 'last-queued write wins after serialization');
    });

    it('should serialize concurrent writes that use different path strings', async() => {
      const fp = tmp('race-alias.txt');
      const alias = path.relative(process.cwd(), fp);
      const first = Buffer.from('first-alias-write');
      const second = Buffer.from('second-alias-write');

      await Promise.all([
        write(fp, first, { overwrite: true }),
        write(alias, second, { overwrite: true })
      ]);

      assert.equal(fs.readFileSync(fp, 'utf8'), second.toString());
    });

    it('should run the next write if the previous write fails', async() => {
      const fp = tmp('after-error.txt');
      const orig = fs.createWriteStream;
      let count = 0;

      fs.createWriteStream = function(dest, options) {
        const stream = orig.call(this, dest, options);
        if (++count === 1) {
          process.nextTick(() => stream.destroy(new Error('boom')));
        }
        return stream;
      };

      try {
        await assert.rejects(() => write(fp, 'nope'));
        await write(fp, 'recovered');
        assert.equal(fs.readFileSync(fp, 'utf8'), 'recovered');
      } finally {
        fs.createWriteStream = orig;
      }
    });
  });

  describe('sync', () => {
    it('should write files using .sync', () => {
      files.forEach(file => {
        write.sync(file, 'content...');
        assert(fs.existsSync(file));
      });
    });

    it('should not overwrite existing files when specified', () => {
      files.forEach(file => {
        write.sync(file, 'content...');
        assert(fs.existsSync(file));
        assert.throws(() => {
          write.sync(file, 'content...', { overwrite: false });
        });
      });
    });

    it('should not overwrite existing files when specified', () => {
      files.forEach(file => {
        write.sync(file, 'content...');
        assert(fs.existsSync(file));
        const result = write.sync(file, 'content...', { increment: true });
        assert.notEqual(file, result.path);
        assert(fs.existsSync(result.path));
      });
    });
  });

  describe('stream', () => {
    it('should write files using .stream', async() => {
      const promise = file => {
        return new Promise((resolve, reject) => {
          toStream('this is content...')
            .pipe(write.stream(file))
            .on('close', resolve)
            .on('error', reject);
        });
      };

      for (let file of files) {
        await promise(file);
        assert(fs.existsSync(file));
        let contents = fs.readFileSync(file, 'utf8');
        assert.equal('this is content...', contents.toString());
      }
    });

    it('should overwrite an existing file', async() => {
      const fixtures = [...files, 'e.md', 'e.md'].map(n => tmp(n));
      const promise = file => {
        return new Promise((resolve, reject) => {
          toStream('this is content...')
            .pipe(write.stream(file))
            .on('close', resolve)
            .on('error', reject);
        });
      };

      for (let file of fixtures) {
        await promise(file);
        assert(fs.existsSync(file));
        let contents = fs.readFileSync(file, 'utf8');
        assert.equal('this is content...', contents.toString());
      }
    });
  });
});

