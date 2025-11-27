// Package db provides database migration management
package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// MigrationRunner handles database migrations
type MigrationRunner struct {
	db      *sql.DB
	migrate *migrate.Migrate
}

// NewMigrationRunner creates a new migration runner
func NewMigrationRunner(db *sql.DB) (*MigrationRunner, error) {
	// Create postgres driver instance
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return nil, fmt.Errorf("failed to create postgres driver: %w", err)
	}

	// Create source from embedded filesystem
	sourceDriver, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("failed to create source driver: %w", err)
	}

	// Create migrate instance
	m, err := migrate.NewWithInstance("iofs", sourceDriver, "postgres", driver)
	if err != nil {
		return nil, fmt.Errorf("failed to create migrate instance: %w", err)
	}

	return &MigrationRunner{
		db:      db,
		migrate: m,
	}, nil
}

// Up runs all pending migrations
func (mr *MigrationRunner) Up() error {
	log.Println("Running database migrations...")

	err := mr.migrate.Up()
	if err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migration failed: %w", err)
	}

	if err == migrate.ErrNoChange {
		log.Println("No new migrations to apply")
		return nil
	}

	version, dirty, err := mr.migrate.Version()
	if err != nil {
		return fmt.Errorf("failed to get migration version: %w", err)
	}

	if dirty {
		return fmt.Errorf("database is in dirty state at version %d", version)
	}

	log.Printf("Successfully migrated to version %d\n", version)
	return nil
}

// Down rolls back one migration
func (mr *MigrationRunner) Down() error {
	log.Println("Rolling back last migration...")

	err := mr.migrate.Steps(-1)
	if err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("rollback failed: %w", err)
	}

	if err == migrate.ErrNoChange {
		log.Println("No migrations to roll back")
		return nil
	}

	version, dirty, err := mr.migrate.Version()
	if err != nil {
		// If error is ErrNilVersion, we've rolled back all migrations
		if err == migrate.ErrNilVersion {
			log.Println("Successfully rolled back all migrations")
			return nil
		}
		return fmt.Errorf("failed to get migration version: %w", err)
	}

	if dirty {
		return fmt.Errorf("database is in dirty state at version %d", version)
	}

	log.Printf("Successfully rolled back to version %d\n", version)
	return nil
}

// Version returns the current migration version
func (mr *MigrationRunner) Version() (uint, bool, error) {
	version, dirty, err := mr.migrate.Version()
	if err != nil && err != migrate.ErrNilVersion {
		return 0, false, fmt.Errorf("failed to get version: %w", err)
	}
	return version, dirty, nil
}

// Force sets the migration version without running migrations
// Use with caution - typically only for fixing dirty state
func (mr *MigrationRunner) Force(version int) error {
	log.Printf("Forcing migration version to %d...\n", version)

	err := mr.migrate.Force(version)
	if err != nil {
		return fmt.Errorf("failed to force version: %w", err)
	}

	log.Printf("Successfully forced version to %d\n", version)
	return nil
}

// Drop drops all tables and schema
// WARNING: This is destructive and should only be used in development
func (mr *MigrationRunner) Drop() error {
	log.Println("WARNING: Dropping all database tables...")

	err := mr.migrate.Drop()
	if err != nil {
		return fmt.Errorf("failed to drop database: %w", err)
	}

	log.Println("Successfully dropped all tables")
	return nil
}

// Steps runs n migrations (positive for up, negative for down)
func (mr *MigrationRunner) Steps(n int) error {
	direction := "up"
	if n < 0 {
		direction = "down"
	}

	log.Printf("Running %d migration(s) %s...\n", abs(n), direction)

	err := mr.migrate.Steps(n)
	if err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migration steps failed: %w", err)
	}

	if err == migrate.ErrNoChange {
		log.Println("No migrations to apply")
		return nil
	}

	version, dirty, err := mr.migrate.Version()
	if err != nil && err != migrate.ErrNilVersion {
		return fmt.Errorf("failed to get migration version: %w", err)
	}

	if dirty {
		return fmt.Errorf("database is in dirty state at version %d", version)
	}

	log.Printf("Successfully migrated to version %d\n", version)
	return nil
}

// Close closes the migration runner
func (mr *MigrationRunner) Close() error {
	sourceErr, dbErr := mr.migrate.Close()
	if sourceErr != nil {
		return fmt.Errorf("failed to close source: %w", sourceErr)
	}
	if dbErr != nil {
		return fmt.Errorf("failed to close database: %w", dbErr)
	}
	return nil
}

// ListMigrations returns all available migrations
func ListMigrations() ([]string, error) {
	var migrations []string

	err := fs.WalkDir(migrationsFS, "migrations", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && len(path) > len("migrations/") {
			migrations = append(migrations, path[len("migrations/"):])
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to list migrations: %w", err)
	}

	return migrations, nil
}

// Helper functions

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// SetTenant sets the current tenant for RLS policies
func SetTenant(db *sql.DB, tenantID string) error {
	_, err := db.Exec("SET app.current_tenant = $1", tenantID)
	if err != nil {
		return fmt.Errorf("failed to set tenant: %w", err)
	}
	return nil
}

// ResetTenant clears the current tenant setting
func ResetTenant(db *sql.DB) error {
	_, err := db.Exec("RESET app.current_tenant")
	if err != nil {
		return fmt.Errorf("failed to reset tenant: %w", err)
	}
	return nil
}

// WithTenant executes a function with a specific tenant context
func WithTenant(db *sql.DB, tenantID string, fn func(*sql.DB) error) error {
	// Set tenant
	if err := SetTenant(db, tenantID); err != nil {
		return err
	}

	// Ensure tenant is reset even if function panics
	defer func() {
		if err := ResetTenant(db); err != nil {
			log.Printf("Warning: failed to reset tenant: %v", err)
		}
	}()

	// Execute function
	return fn(db)
}
