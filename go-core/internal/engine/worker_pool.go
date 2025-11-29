package engine

import (
	"sync"
)

// WorkerPool manages a pool of workers for parallel policy evaluation
type WorkerPool struct {
	workers int
	tasks   chan func()
	wg      sync.WaitGroup
	started bool
	mu      sync.Mutex
}

// NewWorkerPool creates a new worker pool
func NewWorkerPool(workers int) *WorkerPool {
	if workers <= 0 {
		workers = 16
	}

	pool := &WorkerPool{
		workers: workers,
		tasks:   make(chan func(), workers*10), // Buffered channel
	}

	pool.start()
	return pool
}

// start initializes the worker goroutines
func (p *WorkerPool) start() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.started {
		return
	}

	for i := 0; i < p.workers; i++ {
		go p.worker()
	}
	p.started = true
}

// worker processes tasks from the queue
func (p *WorkerPool) worker() {
	for task := range p.tasks {
		task()
	}
}

// Submit adds a task to the worker pool
func (p *WorkerPool) Submit(task func()) {
	p.tasks <- task
}

// Stop gracefully stops the worker pool
func (p *WorkerPool) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.started {
		return
	}

	close(p.tasks)
	p.started = false
}

// Workers returns the number of workers
func (p *WorkerPool) Workers() int {
	return p.workers
}
