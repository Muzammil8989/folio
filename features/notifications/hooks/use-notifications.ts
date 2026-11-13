import { NotificationService } from '../services/notification-service';
import { Alert } from 'react-native';
import { useCallback, useEffect, useState } from 'react';

export function useNotifications() {
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        NotificationService.isEnabled().then(val => {
            setEnabled(val);
            setLoading(false);
        });
    }, []);

    const toggle = useCallback(async () => {
        const next = !enabled;
        if (next) {
            const granted = await NotificationService.requestPermissions();
            if (!granted) {
                Alert.alert('Permission Denied', 'Please enable notifications in your device settings to use this feature.');
                return;
            }
        }
        await NotificationService.setEnabled(next);
        setEnabled(next);
        if (next) {
            await NotificationService.syncScheduledReminders();
        } else {
            await NotificationService.cancelScheduledReminders();
        }
    }, [enabled]);

    return { enabled, toggle, loading };
}
