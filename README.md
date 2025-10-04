# js-sequencer

js-sequencer is a JS library sending MIDI-based messages to [js-synthesizer](https://github.com/jet2jet/js-synthesizer), to render audio frames with Web Audio. js-sequencer also parses and serializes Standard MIDI Format (.smf; also known as .mid) files. Since js-sequencer processes MIDI-based messages, js-sequencer can play those files.

Currently js-sequencer is not published as an NPM package, and is intended to use on [pg-fl.jp](https://www.pg-fl.jp) web site. You can use js-sequencer by building manually from this repository, but incompatible update may be applied in the future.

Note that some source codes have non-English (Japanese) comments.

## Build

```
npm install
npm run build           # for normal library
npm run build:minified  # for minified library
```

## Usage

[js-synthesizer](https://github.com/jet2jet/js-synthesizer) and Web Audio feature are required to play MIDI messages. If you want only to use parsing and/or serializing SMF files, they are not required.

### Initialize engine

```js
var engine = new JSSeq.Core.Engine();
```

### Load/Export SMF files

#### load from existing binary

```js
var bin; // loaded SMF binary data
engine.loadSMFData(bin, 0, function (err) {
  if (err) {
    // 'err' is an object (mostly Error object)
    alert('Error: ' + err);
  } else {
    // load done
    console.log('Part count:', engine.parts.length);
    console.log('Duration [sec]:', engine.calculateDuration());
  }
});
// --- or ---
engine.loadSMFDataPromise(bin, 0).then(
  function () {
    // load done
    console.log('Part count:', engine.parts.length);
    console.log('Duration [sec]:', engine.calculateDuration());
  },
  function (err) {
    // 'err' is an object (mostly Error object)
    alert('Error: ' + err);
  }
);
```

#### load from file element

```js
var elem = document.getElementById('MyFileElement');
elem.addEventListener('change', function () {
  engine.loadFromFile(elem, function (err) {
    if (err) {
      // 'err' is an object (mostly Error object)
      alert('Error: ' + err);
    } else {
      // load done
      console.log('Part count:', engine.parts.length);
      console.log('Duration [sec]:', engine.calculateDuration());
    }
  });
  // --- or ---
  engine.loadFromFilePromise(elem).then(
    function () {
      // load done
      console.log('Part count:', engine.parts.length);
      console.log('Duration [sec]:', engine.calculateDuration());
    },
    function (err) {
      // 'err' is an object (mostly Error object)
      alert('Error: ' + err);
    }
  );
});
```

#### generate SMF data

```js
var bin = engine.exportSMFToArrayBuffer(); // 'bin' will be ArrayBuffer
var blobUrl = engine.makeSMFBlobURL(); // 'blob:' URL
```

### Check if the playing feature is available

```js
if (!JSSeq.Core.Player.isSupported()) {
  throw new Error('Not supported on this browser.');
}
```

### Initialize player (to play MIDI messages)

```js
// the worker file of js-sequencer (dist/js-sequencer.worker.*.js)
const JSFile_SeqWorker = 'js-sequencer.worker.min.js';
// the dependencies of js-sequencer (js-synthesizer and its dependencies)
// these paths must be relative to JSFile_SeqWorker
const JSFile_Deps = ['libfluidsynth-2.0.2.js', 'js-synthesizer.min.js'];
// the worklet files of js-sequencer (used if supported)
// these paths must be relative to the document
const JSFile_SeqWorklet = ['js-sequencer.worklet.min.js'];

let player;

JSSeq.Core.Player.instantiate(
  // JSSeq.Core.Engine instance
  engine,
  // worker script path
  JSFile_SeqWorker,
  // dependencies of worker
  JSFile_Deps,
  // if you create multiple player instance and
  // want to share worker between instances, set true
  // (default: false)
  false,
  // timer interval of worker processing
  // (default: 30)
  30,
  // frame count per one render process
  // (default: 8192)
  8192,
  // sample rate (default: 48000)
  48000
).then((p) => {
  player = p;
  // if you want not to use AudioWorklet even if supported,
  // call with null parameter
  player.setAudioWorkletScripts(JSFile_SeqWorklet);
});
```

### Play notes manually

```js
const notes = [
  // parameters: posNum, posDen, lenNum, lenDen, value, channel
  //  - posNum: numerator of position (used by sequencer process and SMF data)
  //  - posDen: denominator of position (used by sequencer process and SMF data)
  //    - e.g. (posNum,posDen)=(1,4) represents the position after one quarter note from beginning
  //  - lenNum: numerator of length (used by sequencer process and SMF data)
  //  - lenDen: denominator of length (used by sequencer process and SMF data)
  //    - e.g. (lenNum,lenDen)=(1,4) represents the length of one quarter note
  //  - value: MIDI note value
  //  - channel: MIDI channel (zero-based index)
  new JSSeq.Core.NoteObject(0, 1, 0, 1, 60, 0),
  new JSSeq.Core.NoteObject(0, 1, 0, 1, 64, 0),
];
player.playNoteMultiple(notes);
window.setTimeout(() => {
  // playNoteMultiple doesn't stop notes automatically even if
  // 'noteLength's are specified.
  player.stopNoteMultiple(
    notes,
    true // set true to release internal player data after a few seconds
  );
}, 5000);
```

### Play sequential notes

```js
// (usage of 'loadFromFilePromise' is described above)
engine.loadFromFilePromise(elem).then(function () {
  player.playSequence();
});
```

**Note: If the played music has glitch, consider creating `AudioContext` manually with `latencyHint: 'playback'`.** (`playSequence` accepts `AudioContext` instance.)

## License

[BSD 3-Clause License](./LICENSE)
