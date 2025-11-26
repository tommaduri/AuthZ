package policy

import (
	"sync"
	"testing"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewNotifier(t *testing.T) {
	n := NewNotifier()
	assert.NotNil(t, n)
	assert.NotNil(t, n.handlers)
	assert.NotNil(t, n.eventQueue)
	assert.NotNil(t, n.done)
}

func TestNotifier_Subscribe(t *testing.T) {
	n := NewNotifier()

	callCount := 0
	handler := func(event NotificationEvent) {
		callCount++
	}

	n.Subscribe(NotifyPolicyUpdated, handler)
	assert.Equal(t, 1, n.GetSubscriberCount(NotifyPolicyUpdated))

	// Add another handler
	n.Subscribe(NotifyPolicyUpdated, handler)
	assert.Equal(t, 2, n.GetSubscriberCount(NotifyPolicyUpdated))
}

func TestNotifier_SubscribeAll(t *testing.T) {
	n := NewNotifier()

	handler := func(event NotificationEvent) {}

	n.SubscribeAll(handler)

	// Check all event types have the handler
	assert.GreaterOrEqual(t, n.GetSubscriberCount(NotifyPolicyUpdated), 1)
	assert.GreaterOrEqual(t, n.GetSubscriberCount(NotifyPolicyRolledBack), 1)
	assert.GreaterOrEqual(t, n.GetSubscriberCount(NotifyPolicyValidationFailed), 1)
	assert.GreaterOrEqual(t, n.GetSubscriberCount(NotifyVersionCreated), 1)
}

func TestNotifier_PublishSync(t *testing.T) {
	n := NewNotifier()

	var receivedEvent NotificationEvent
	var wg sync.WaitGroup
	wg.Add(1)

	handler := func(event NotificationEvent) {
		receivedEvent = event
		wg.Done()
	}

	n.Subscribe(NotifyPolicyUpdated, handler)

	event := NotificationEvent{
		Type:      NotifyPolicyUpdated,
		Timestamp: time.Now(),
		Version:   1,
		Comment:   "Test update",
	}

	n.PublishSync(event)
	wg.Wait()

	assert.Equal(t, NotifyPolicyUpdated, receivedEvent.Type)
	assert.Equal(t, int64(1), receivedEvent.Version)
	assert.Equal(t, "Test update", receivedEvent.Comment)
}

func TestNotifier_PublishAsync(t *testing.T) {
	n := NewNotifier()
	n.Start()
	defer n.Stop()

	var receivedEvents []NotificationEvent
	var mu sync.Mutex
	var wg sync.WaitGroup

	handler := func(event NotificationEvent) {
		mu.Lock()
		receivedEvents = append(receivedEvents, event)
		mu.Unlock()
		wg.Done()
	}

	n.Subscribe(NotifyPolicyUpdated, handler)

	// Publish multiple events
	numEvents := 5
	wg.Add(numEvents)
	for i := 0; i < numEvents; i++ {
		event := NotificationEvent{
			Type:      NotifyPolicyUpdated,
			Timestamp: time.Now(),
			Version:   int64(i + 1),
		}
		n.Publish(event)
	}

	wg.Wait()
	time.Sleep(100 * time.Millisecond) // Allow async processing

	mu.Lock()
	assert.Equal(t, numEvents, len(receivedEvents))
	mu.Unlock()
}

func TestNotifier_MultipleHandlers(t *testing.T) {
	n := NewNotifier()

	callCount1 := 0
	callCount2 := 0
	var wg sync.WaitGroup
	wg.Add(2)

	handler1 := func(event NotificationEvent) {
		callCount1++
		wg.Done()
	}

	handler2 := func(event NotificationEvent) {
		callCount2++
		wg.Done()
	}

	n.Subscribe(NotifyPolicyUpdated, handler1)
	n.Subscribe(NotifyPolicyUpdated, handler2)

	event := NotificationEvent{
		Type:      NotifyPolicyUpdated,
		Timestamp: time.Now(),
	}

	n.PublishSync(event)
	wg.Wait()

	assert.Equal(t, 1, callCount1)
	assert.Equal(t, 1, callCount2)
}

func TestNotifier_DifferentNotificationEventTypes(t *testing.T) {
	n := NewNotifier()
	n.Start()
	defer n.Stop()

	var updateEvents []NotificationEvent
	var rollbackEvents []NotificationEvent
	var mu sync.Mutex
	var wg sync.WaitGroup

	updateHandler := func(event NotificationEvent) {
		mu.Lock()
		updateEvents = append(updateEvents, event)
		mu.Unlock()
		wg.Done()
	}

	rollbackHandler := func(event NotificationEvent) {
		mu.Lock()
		rollbackEvents = append(rollbackEvents, event)
		mu.Unlock()
		wg.Done()
	}

	n.Subscribe(NotifyPolicyUpdated, updateHandler)
	n.Subscribe(NotifyPolicyRolledBack, rollbackHandler)

	wg.Add(2)

	n.Publish(NotificationEvent{Type: NotifyPolicyUpdated, Version: 1})
	n.Publish(NotificationEvent{Type: NotifyPolicyRolledBack, Version: 2})

	wg.Wait()
	time.Sleep(100 * time.Millisecond)

	mu.Lock()
	assert.Equal(t, 1, len(updateEvents))
	assert.Equal(t, 1, len(rollbackEvents))
	mu.Unlock()
}

func TestNotifier_ClearSubscribers(t *testing.T) {
	n := NewNotifier()

	handler := func(event NotificationEvent) {}

	n.Subscribe(NotifyPolicyUpdated, handler)
	n.Subscribe(NotifyPolicyUpdated, handler)
	assert.Equal(t, 2, n.GetSubscriberCount(NotifyPolicyUpdated))

	n.ClearSubscribers(NotifyPolicyUpdated)
	assert.Equal(t, 0, n.GetSubscriberCount(NotifyPolicyUpdated))
}

func TestNotifier_ClearAllSubscribers(t *testing.T) {
	n := NewNotifier()

	handler := func(event NotificationEvent) {}

	n.Subscribe(NotifyPolicyUpdated, handler)
	n.Subscribe(NotifyPolicyRolledBack, handler)
	assert.Equal(t, 1, n.GetSubscriberCount(NotifyPolicyUpdated))
	assert.Equal(t, 1, n.GetSubscriberCount(NotifyPolicyRolledBack))

	n.ClearAllSubscribers()
	assert.Equal(t, 0, n.GetSubscriberCount(NotifyPolicyUpdated))
	assert.Equal(t, 0, n.GetSubscriberCount(NotifyPolicyRolledBack))
}

func TestNotifier_EventWithError(t *testing.T) {
	n := NewNotifier()

	var receivedError error
	var wg sync.WaitGroup
	wg.Add(1)

	handler := func(event NotificationEvent) {
		receivedError = event.Error
		wg.Done()
	}

	n.Subscribe(NotifyPolicyValidationFailed, handler)

	testErr := assert.AnError
	event := NotificationEvent{
		Type:      NotifyPolicyValidationFailed,
		Timestamp: time.Now(),
		Error:     testErr,
	}

	n.PublishSync(event)
	wg.Wait()

	assert.Equal(t, testErr, receivedError)
}

func TestNotifier_EventWithPolicies(t *testing.T) {
	n := NewNotifier()

	var receivedPolicies map[string]*types.Policy
	var wg sync.WaitGroup
	wg.Add(1)

	handler := func(event NotificationEvent) {
		receivedPolicies = event.Policies
		wg.Done()
	}

	n.Subscribe(NotifyPolicyUpdated, handler)

	policies := map[string]*types.Policy{
		"policy1": {
			Name:         "TestPolicy",
			ResourceKind: "document",
		},
	}

	event := NotificationEvent{
		Type:      NotifyPolicyUpdated,
		Timestamp: time.Now(),
		Policies:  policies,
	}

	n.PublishSync(event)
	wg.Wait()

	require.NotNil(t, receivedPolicies)
	assert.Equal(t, "TestPolicy", receivedPolicies["policy1"].Name)
}

func TestNotifier_StartStop(t *testing.T) {
	n := NewNotifier()

	// Start processing
	n.Start()

	// Publish some events
	n.Publish(NotificationEvent{Type: NotifyPolicyUpdated})
	n.Publish(NotificationEvent{Type: NotifyPolicyRolledBack})

	// Stop and wait
	n.Stop()

	// Verify clean shutdown (no panics)
}
