import { useState } from 'react';
import { api } from '@/lib/api';

interface DeleteGroupModalProps {
  groupId: string;
  groupName: string;
  onDeleted: () => void;
  onClose: () => void;
}

export function DeleteGroupModal({ groupId, groupName, onDeleted, onClose }: DeleteGroupModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const canDelete = confirmText.toLowerCase() === 'delete';

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setError('');
    try {
      await api.deleteGroup(groupId);
      onDeleted();
    } catch {
      setError('Failed to delete group. Try again.');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6">
        <h2 className="text-lg font-bold text-red-600 mb-2">Delete Group</h2>
        <p className="text-sm text-lamo-gray mb-1">
          Are you sure you want to delete <strong className="text-lamo-dark">{groupName}</strong>?
        </p>
        <p className="text-sm text-lamo-gray mb-4">
          This will remove all members and game history. This action cannot be undone.
        </p>
        <label className="block text-sm font-medium text-lamo-dark mb-1.5">
          Type <strong>delete</strong> to confirm
        </label>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="delete"
          className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark placeholder:text-lamo-gray-muted focus:outline-none focus:ring-2 focus:ring-red-400/40 mb-4"
          autoFocus
        />
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            className="flex-1 px-4 py-2.5 bg-red-600 text-white font-semibold rounded-pill hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {deleting ? 'Deleting...' : 'Delete Group'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-lamo-border text-lamo-dark font-semibold rounded-pill hover:bg-lamo-bg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
