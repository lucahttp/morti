
# 🎙️ Morti (Mortimer)

**Free • Offline • Local • Browser-Based • WebGPU**

Morti is a fully offline voice assistant that lives entirely in your browser. like JARVIS or TARS but you don't require a cloud connection or a complex setup.

---

### The Motivation

Most Voice AI agents promise a great experience but come with a catch: online tools have strict limits and privacy risks, while local setups lead straight to 'dependency hell.' Worst of all are the 'local' tools that still require an OpenAI API key. You shouldn't have to spend three days wrestling with CUDA drivers, compiling Python wheels, and troubleshooting obscure libraries only to find out your PC can’t even run the model.


**Morti changes that.** By harnessing **Transformers.js**, **ONNX**, and **WebGPU**, Morti gives you a high-performance voice agent that works wherever you are:

* 🚗 **Driving:** Hands-free interaction when you can't look at a screen.
* 🛌 **Resting:** Talk to your AI without glowing screens in your face.
* 📵 **Offline:** Full functionality in dead zones or during internet outages.
* 🛠️ **Zero Setup:** No CUDA, no Python, no installations. If you have a browser, you have Morti.

---

### 🚀 Key Features

* **100% Private:** Your voice and data never leave your machine.
* **WebGPU Accelerated:** Native hardware speed directly in the browser.
* **Voice-to-Voice:** Fully auditory interface designed for hands-free use.
* **Local Caching:** Models download once and work offline forever after.

---

### 🛠️ The Morti Tech Stack

| Category | Component |  Model | Role in Morti |
| --- | --- | --- | --- |
| **Ears (STT)** | **Speech-to-Text** | `onnx-community/whisper-tiny.en` | Transcribes your voice into text in real-time. |
| **Brain (LLM)** | **Language Model** | `qwen3-0.6B` | The "thinker" that understands and generates replies. |
| **Voice (TTS)** | **Text-to-Speech** | `Supertonic2` | Generates high-quality, natural human speech. |
| **Wake Word** | **Trigger Word** | `HeyBuddy` | Optional: Listens for "Hey Mortimer" to activate. |

---

### 🏁 Quick Start (Development)

1. **Clone the repo:**
```bash
git clone https://github.com/lucahttp/morti.git
cd morti

```


2. **Install dependencies:**
```bash
npm install

```


3. **Run the local dev server:**
```bash
npm run dev

```


4. **Open your browser** to the local URL and ensure **WebGPU** is enabled.

---

Tested on a RTX 3070 and workd flawlesly


Special thanks to https://github.com/xenova/ for all his work and documentations, without his work this couldnt be made

*Built with ❤️, google Antigravity and a lot of hours of debugging.*
