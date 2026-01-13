import { useState, useEffect, useCallback } from 'react';

const DB_NAME = 'DebugAudioDB';
const STORE_NAME = 'clips';
const DB_VERSION = 1;

export const useDebugAudio = () => {
    const [clips, setClips] = useState([]);
    const [db, setDb] = useState(null);

    useEffect(() => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = (e) => {
            setDb(e.target.result);
        };
        request.onerror = (e) => console.error("IndexedDB error:", e);
    }, []);

    const refreshClips = useCallback(() => {
        if (!db) return;
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
            // We only need the metadata for the list
            setClips(request.result.map(c => ({ id: c.id, name: c.name, size: c.data.byteLength })));
        };
    }, [db]);

    useEffect(() => {
        if (db) refreshClips();
    }, [db, refreshClips]);

    const addClip = async (file) => {
        if (!db) return;
        const arrayBuffer = await file.arrayBuffer();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.add({ name: file.name, data: arrayBuffer, type: file.type });
        transaction.oncomplete = () => refreshClips();
    };

    const deleteClip = (id) => {
        if (!db) return;
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete(id);
        transaction.oncomplete = () => refreshClips();
    };

    const getClipData = (id) => {
        return new Promise((resolve, reject) => {
            if (!db) return reject("DB not initialized");
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result.data);
            request.onerror = () => reject(request.error);
        });
    };

    return { clips, addClip, deleteClip, getClipData };
};
