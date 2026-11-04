// Piezas de interfaz comunes: modales (<dialog>), avisos, confirmación y el único
// gestor de clics de la app.
//
// Clics: cualquier elemento con data-action="nombre" ejecuta la acción registrada con
// registerActions({ nombre: (el, event) => ... }). Sirve igual para botones fijos del
// HTML y para los que se generan con plantillas. data-close="idModal" cierra un modal.

import { $ } from './util.js';

const actions = {};

export function registerActions(map) {
    Object.assign(actions, map);
}

export function setupActions() {
    document.addEventListener('click', (e) => {
        const closer = e.target.closest('[data-close]');
        if (closer) {
            closeModal(closer.dataset.close);
            return;
        }
        // clic en el fondo del <dialog> (fuera de .modal-content)
        if (e.target.tagName === 'DIALOG' && !e.target.dataset.persistent) {
            closeModal(e.target.id);
            return;
        }
        const el = e.target.closest('[data-action]');
        if (!el || !actions[el.dataset.action]) return;
        if (el.tagName !== 'INPUT' && el.tagName !== 'LABEL') e.preventDefault();
        Promise.resolve()
            .then(() => actions[el.dataset.action](el, e))
            .catch(err => {
                console.error(err);
                showToast('Algo ha fallado: ' + err.message, true);
            });
    });
}

// ---------------------------------------------------------------- modales

const closeHandlers = {};

// Se llama al cerrar (con ✕, Escape, fondo o closeModal).
export function onModalClose(id, fn) {
    closeHandlers[id] = fn;
}

export function openModal(id) {
    const dialog = $(id);
    if (!dialog.open) {
        dialog.showModal();
        if (!dialog.dataset.closeBound) {
            dialog.addEventListener('close', () => closeHandlers[id]?.());
            dialog.dataset.closeBound = '1';
        }
    }
    const content = dialog.querySelector('.modal-content');
    if (content) content.scrollTop = 0;
    return dialog;
}

export function closeModal(id) {
    const dialog = $(id);
    if (dialog?.open) dialog.close();
}

export function isModalOpen(id) {
    return Boolean($(id)?.open);
}

// ---------------------------------------------------------------- avisos

let toastTimer = null;

export function showToast(message, isError = false) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.toggle('toast-error', isError);
    toast.hidden = false;
    // por encima de los <dialog> abiertos (capa superior): se mueve al último abierto
    const top = [...document.querySelectorAll('dialog[open]')].pop();
    (top || document.body).appendChild(toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, isError ? 5000 : 2600);
}

// ---------------------------------------------------------------- confirmación

let confirmAction = null;

export function askConfirm(message, yesLabel, onYes, { danger = true, noLabel = 'Cancelar' } = {}) {
    confirmAction = onYes;
    $('confirmMessage').innerText = message;
    $('confirmNoBtn').textContent = noLabel;
    const yes = $('confirmYesBtn');
    yes.textContent = yesLabel;
    yes.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    openModal('confirmModal');
}

registerActions({
    'confirm-no': () => {
        confirmAction = null;
        closeModal('confirmModal');
    },
    'confirm-yes': async () => {
        const action = confirmAction;
        confirmAction = null;
        closeModal('confirmModal');
        if (!action) return;
        try {
            await action();
        } catch (e) {
            console.error(e);
            showToast('No se pudo completar: ' + e.message, true);
        }
    }
});
