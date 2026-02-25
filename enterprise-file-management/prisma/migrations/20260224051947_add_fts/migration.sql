-- AlterTable: Add the tsvector column
ALTER TABLE "FileObject" ADD COLUMN "searchVector" tsvector;

-- CreateIndex: GIN index for fast full-text search
CREATE INDEX "FileObject_searchVector_idx" ON "FileObject" USING GIN ("searchVector");

-- Create trigger function to keep searchVector up-to-date
CREATE OR REPLACE FUNCTION file_object_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW."searchVector" := to_tsvector(
    'english',
    coalesce(NEW.name, '') || ' ' || coalesce(NEW."mimeType", '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach the trigger for INSERT and UPDATE
CREATE TRIGGER file_object_search_vector_trigger
BEFORE INSERT OR UPDATE ON "FileObject"
FOR EACH ROW EXECUTE FUNCTION file_object_search_vector_update();

-- Backfill existing rows
UPDATE "FileObject"
SET "searchVector" = to_tsvector(
  'english',
  coalesce(name, '') || ' ' || coalesce("mimeType", '')
);
