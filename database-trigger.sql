-- Database trigger to auto-set completed_at when customer status changes to completed

-- Function to auto-fill completed_at timestamp
CREATE OR REPLACE FUNCTION auto_set_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  -- If completed changed from false to true, set completed_at
  IF NEW.completed = true AND (OLD.completed = false OR OLD.completed IS NULL) THEN
    NEW.completed_at = NOW();
  END IF;
  
  -- If completed changed from true to false, clear completed_at
  IF NEW.completed = false AND OLD.completed = true THEN
    NEW.completed_at = NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on assigned_customers table
DROP TRIGGER IF EXISTS trigger_auto_completed_at ON assigned_customers;

CREATE TRIGGER trigger_auto_completed_at
  BEFORE UPDATE ON assigned_customers
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_completed_at();

-- Test the trigger (optional)
-- UPDATE assigned_customers SET completed = true WHERE customer_code = 'TEST_001';