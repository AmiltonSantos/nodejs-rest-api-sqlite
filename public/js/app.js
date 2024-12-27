async function fetchUsers() {
  try {
    const response = await fetch('/api/read/users');
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    const users = await response.json();
    const userList = document.getElementById('user-list');
    userList.innerHTML = users.data.map(user => `<li>${user.id}. ${user.name} - ${user.email}</li>`).join('');
  } catch (error) {
    console.error('Error fetching Uses:', error);
  }
}

window.onload = fetchUsers;