
export class Mutex {
    constructor() {
        this._queue = [];
        this._locked = false;
    }

    lock() {
        return new Promise((resolve) => {
            if (this._locked) {
                this._queue.push(resolve);
            } else {
                this._locked = true;
                resolve();
            }
        });
    }

    unlock() {
        if (this._queue.length > 0) {
            const resolve = this._queue.shift();
            resolve();
        } else {
            this._locked = false;
        }
    }

    async runExclusive(callback) {
        await this.lock();
        try {
            return await callback();
        } finally {
            this.unlock();
        }
    }

    isLocked() {
        return this._locked;
    }
}
