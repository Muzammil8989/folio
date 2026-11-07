import { AppButton, AppModal, SheetHeader, ThemedText } from '@/components/common';
import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { BackupService } from '@/features/backup/services/backup-service';
import { logger } from '@/lib/logger';
import { useModalActions } from '@/providers/modal-context';
import { useUser } from '@/features/user/context/user-context';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, InteractionManager, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsGroup } from './settings-group';
import { SettingsItem } from './settings-item';
import { ToggleRow } from './toggle-row';

// ─── Main section ────────────────────────────────────────────────────────────

export function DataBackupSection({ onRestoreComplete }: { onRestoreComplete?: () => void }) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const { openModal } = useModalActions();
    const { updateProfile } = useUser();
    const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
    const [lastExportTime, setLastExportTime] = useState<Date | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [showRestoreModal, setShowRestoreModal] = useState(false);

    // Always read from SecureStore — this is the single source of truth
    const loadPrefs = useCallback(async () => {
        const [enabled, last] = await Promise.all([
            BackupService.getAutoBackupEnabled(),
            BackupService.getLastBackupTime(),
        ]);
        setAutoBackupEnabled(enabled);
        setLastExportTime(last);
    }, []);

    useEffect(() => { loadPrefs(); }, [loadPrefs]);

    // ── Export ──────────────────────────────────────────────────────────────

    const handleExport = async () => {
        if (isExporting) return;
        setIsExporting(true);
        try {
            const result = await BackupService.saveToDevice({ allowPrompt: true });
            if (!result) return; // skipped (no folder) — only happens for silent auto-backup
            const { fileName, location } = result;
            await loadPrefs(); // re-read SecureStore so display is always accurate
            Alert.alert('Backup Saved', `"${fileName}" has been saved to ${location}.`);
        } catch (error) {
            logger.error('Export failed', error);
            const msg = error instanceof Error ? error.message : 'Unknown error';
            Alert.alert('Export Failed', msg);
        } finally {
            setIsExporting(false);
        }
    };

    // ── Restore ─────────────────────────────────────────────────────────────

    // Open the picker WITHOUT closing the modal first.
    // The system file picker appears on top of the modal; if the user
    // cancels it they land back on the warning sheet and can try again.
    const handleSelectFile = async () => {
        if (isImporting) return;
        setIsImporting(true);
        try {
            const result = await BackupService.pickAndRestoreBackup();
            if (result.profile) await updateProfile(result.profile);
            // File was selected and restore succeeded — now close the sheet
            setShowRestoreModal(false);
            await loadPrefs();
            InteractionManager.runAfterInteractions(() => {
                Alert.alert('Restore Complete', result.message, [
                    { text: 'OK', onPress: () => onRestoreComplete?.() },
                ]);
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            if (msg === 'No file selected') {
                // User cancelled picker — leave modal open so they can retry
                return;
            }
            logger.error('Restore failed', error);
            setShowRestoreModal(false);
            InteractionManager.runAfterInteractions(() => {
                Alert.alert('Restore Failed', msg);
            });
        } finally {
            setIsImporting(false);
        }
    };

    // ── Auto-backup toggle ───────────────────────────────────────────────────

    const handleAutoBackupToggle = async () => {
        const next = !autoBackupEnabled;
        setAutoBackupEnabled(next);
        await BackupService.setAutoBackupEnabled(next);
    };

    // ── Helpers ──────────────────────────────────────────────────────────────

    const formatLastExport = (): string => {
        if (!lastExportTime) return 'No backup yet';
        const diff = Date.now() - lastExportTime.getTime();
        const mins = Math.floor(diff / 60000);
        const hrs = Math.floor(mins / 60);
        const days = Math.floor(hrs / 24);
        if (mins < 1) return 'Last backup: just now';
        if (mins < 60) return `Last backup: ${mins}m ago`;
        if (hrs < 24) return `Last backup: ${hrs}h ago`;
        if (days === 1) return 'Last backup: yesterday';
        if (days < 7) return `Last backup: ${days} days ago`;
        return `Last backup: ${lastExportTime.toLocaleDateString()}`;
    };

    // ── Render ───────────────────────────────────────────────────────────────

    return (
        <>
            <SettingsGroup
                title="Data & backup"
                footer="Back up regularly. If you forget your PIN or switch phones, a backup is the only way to get your data back."
            >
                <SettingsItem
                    icon="document-text-outline"
                    title="Export report"
                    subtitle="PDF summary or Excel workbook"
                    onPress={() => openModal('export')}
                />
                <SettingsItem
                    icon={isExporting ? 'hourglass-outline' : 'download-outline'}
                    title={isExporting ? 'Saving backup…' : 'Back up now'}
                    subtitle={formatLastExport()}
                    onPress={handleExport}
                    disabled={isExporting}
                />
                <SettingsItem
                    icon={isImporting ? 'hourglass-outline' : 'cloud-upload-outline'}
                    title={isImporting ? 'Restoring…' : 'Restore from backup'}
                    subtitle="Replace everything with a backup file"
                    onPress={() => setShowRestoreModal(true)}
                    disabled={isImporting}
                />
                <ToggleRow
                    icon="timer-outline"
                    title="Automatic backup"
                    subtitle={autoBackupEnabled ? 'Every 12 hours' : 'Off'}
                    enabled={autoBackupEnabled}
                    onToggle={handleAutoBackupToggle}
                    noBorder
                />
            </SettingsGroup>

            {/* Restore confirmation. A plain Modal (not BottomSheet) so the system file
                picker can open on top of it; cancelling the picker returns here. */}
            <AppModal
                visible={showRestoreModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowRestoreModal(false)}
            >
                <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}>
                    <Pressable
                        style={{ flex: 1 }}
                        onPress={() => setShowRestoreModal(false)}
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                    />
                    <View
                        style={{
                            width: '100%',
                            maxWidth: MAX_CONTENT_WIDTH,
                            alignSelf: 'center',
                            backgroundColor: colors.surface,
                            borderTopLeftRadius: 24,
                            borderTopRightRadius: 24,
                            borderTopWidth: 1,
                            borderColor: colors.divider,
                            paddingHorizontal: 24,
                            paddingTop: 16,
                            paddingBottom: insets.bottom + 28,
                        }}
                    >
                        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: 'center', marginBottom: 20 }} />
                        <SheetHeader kicker="Backup" title="Restore from backup" onClose={() => setShowRestoreModal(false)} />

                        <ThemedText style={{ color: colors.textSecondary }} className="text-[15px] leading-6 mb-4">
                            Choose a Folio backup file (.json). Its data will replace what is on this phone.
                        </ThemedText>

                        <View className="rounded-xl px-4 py-3 mb-6 bg-warningBg dark:bg-dark-warningBg">
                            {[
                                'All current transactions will be deleted',
                                'Accounts, budgets and categories will be replaced',
                                'This cannot be undone',
                            ].map((item, i) => (
                                <View key={item} className={`flex-row items-start ${i < 2 ? 'mb-2' : ''}`}>
                                    <Ionicons name="alert-circle-outline" size={16} color={colors.warningText} style={{ marginTop: 2, marginRight: 8 }} />
                                    <ThemedText className="flex-1 text-[14px] leading-5" style={{ color: colors.warningText }}>{item}</ThemedText>
                                </View>
                            ))}
                        </View>

                        <AppButton
                            label={isImporting ? 'Restoring…' : 'Choose backup file'}
                            icon="folder-open-outline"
                            onPress={handleSelectFile}
                            loading={isImporting}
                            disabled={isImporting}
                        />
                        <View className="h-2" />
                        <AppButton label="Cancel" variant="secondary" onPress={() => setShowRestoreModal(false)} />
                    </View>
                </View>
            </AppModal>
        </>
    );
}
