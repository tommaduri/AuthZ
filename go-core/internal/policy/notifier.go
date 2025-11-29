package policy

import (
	"sync"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
)

// NotificationEventType represents the type of policy notification event
type NotificationEventType string

const (
	// NotifyPolicyUpdated fires when policies are updated
	NotifyPolicyUpdated NotificationEventType = "policy.updated"
	// NotifyPolicyRolledBack fires when policies are rolled back
	NotifyPolicyRolledBack NotificationEventType = "policy.rolled_back"
	// NotifyPolicyValidationFailed fires when policy validation fails
	NotifyPolicyValidationFailed NotificationEventType = "policy.validation_failed"
	// NotifyVersionCreated fires when a new version is created
	NotifyVersionCreated NotificationEventType = "version.created"
)

// NotificationEvent represents a policy change notification
type NotificationEvent struct {
	Type      NotificationEventType
	Timestamp time.Time
	Version   int64
	Policies  map[string]*types.Policy
	Error     error
	Comment   string
}

// NotificationHandler is a function that handles policy notifications
type NotificationHandler func(event NotificationEvent)

// Notifier manages policy update notifications using pub/sub pattern
type Notifier struct {
	mu         sync.RWMutex
	handlers   map[NotificationEventType][]NotificationHandler
	eventQueue chan NotificationEvent
	done       chan struct{}
	wg         sync.WaitGroup
}

// NewNotifier creates a new policy notifier
func NewNotifier() *Notifier {
	return &Notifier{
		handlers:   make(map[NotificationEventType][]NotificationHandler),
		eventQueue: make(chan NotificationEvent, 100), // Buffered for async processing
		done:       make(chan struct{}),
	}
}

// Subscribe registers a handler for specific event types
func (n *Notifier) Subscribe(eventType NotificationEventType, handler NotificationHandler) {
	n.mu.Lock()
	defer n.mu.Unlock()

	n.handlers[eventType] = append(n.handlers[eventType], handler)
}

// SubscribeAll registers a handler for all event types
func (n *Notifier) SubscribeAll(handler NotificationHandler) {
	n.mu.Lock()
	defer n.mu.Unlock()

	for eventType := range n.handlers {
		n.handlers[eventType] = append(n.handlers[eventType], handler)
	}

	// Also subscribe to future event types
	n.handlers[NotifyPolicyUpdated] = append(n.handlers[NotifyPolicyUpdated], handler)
	n.handlers[NotifyPolicyRolledBack] = append(n.handlers[NotifyPolicyRolledBack], handler)
	n.handlers[NotifyPolicyValidationFailed] = append(n.handlers[NotifyPolicyValidationFailed], handler)
	n.handlers[NotifyVersionCreated] = append(n.handlers[NotifyVersionCreated], handler)
}

// Publish sends an event to all registered handlers asynchronously
func (n *Notifier) Publish(event NotificationEvent) {
	select {
	case n.eventQueue <- event:
		// Event queued successfully
	default:
		// Queue full - skip event (non-blocking)
	}
}

// PublishSync sends an event to all registered handlers synchronously
func (n *Notifier) PublishSync(event NotificationEvent) {
	n.mu.RLock()
	handlers := n.handlers[event.Type]
	n.mu.RUnlock()

	for _, handler := range handlers {
		handler(event)
	}
}

// Start begins processing events from the queue
func (n *Notifier) Start() {
	n.wg.Add(1)
	go n.processEvents()
}

// Stop stops processing events and waits for pending events
func (n *Notifier) Stop() {
	close(n.done)
	n.wg.Wait()
	close(n.eventQueue)
}

// processEvents processes events from the queue
func (n *Notifier) processEvents() {
	defer n.wg.Done()

	for {
		select {
		case <-n.done:
			// Drain remaining events
			for len(n.eventQueue) > 0 {
				event := <-n.eventQueue
				n.notifyHandlers(event)
			}
			return

		case event := <-n.eventQueue:
			n.notifyHandlers(event)
		}
	}
}

// notifyHandlers notifies all registered handlers for an event
func (n *Notifier) notifyHandlers(event NotificationEvent) {
	n.mu.RLock()
	handlers := n.handlers[event.Type]
	n.mu.RUnlock()

	for _, handler := range handlers {
		// Call handler in goroutine for non-blocking notification
		go handler(event)
	}
}

// GetSubscriberCount returns the number of subscribers for an event type
func (n *Notifier) GetSubscriberCount(eventType NotificationEventType) int {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return len(n.handlers[eventType])
}

// ClearSubscribers removes all subscribers for an event type
func (n *Notifier) ClearSubscribers(eventType NotificationEventType) {
	n.mu.Lock()
	defer n.mu.Unlock()
	delete(n.handlers, eventType)
}

// ClearAllSubscribers removes all subscribers
func (n *Notifier) ClearAllSubscribers() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.handlers = make(map[NotificationEventType][]NotificationHandler)
}
