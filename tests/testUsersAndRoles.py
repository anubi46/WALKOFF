import json
import unittest

from flask_security.utils import verify_password
from server import flaskServer as server

class TestUsersAndRoles(unittest.TestCase):
    def setUp(self):
        self.app = server.app.test_client(self)
        self.app.testing = True
        self.app.post('/login', data=dict(email='admin', password='admin'), follow_redirects=True)
        response = self.app.post('/key', data=dict(email='admin', password='admin'), follow_redirects=True).get_data(as_text=True)

        self.key = json.loads(response)["auth_token"]
        self.headers = {"Authentication-Token" : self.key}
        self.name = "testRoleOne"
        self.description = "testRoleOne description"

        self.email = "testUser"
        self.password = "password"

    def tearDown(self):
        with server.running_context.flask_app.app_context():
            # server.running_context.User.query.filter_by(email=self.email).delete()
            # server.database.db.session.commit()

            email = self.email
            u = server.user_datastore.get_user(email)
            if u:
                server.user_datastore.delete_user(u)

            server.running_context.Role.query.filter_by(name=self.name).delete()
            server.database.db.session.commit()

    def testAddRole(self):
        data = {"name" : self.name}
        response = json.loads(self.app.post('/roles/add', data=data, headers=self.headers).get_data(as_text=True))
        self.assertEqual(response["status"], "role added {0}".format(self.name))

        response = json.loads(self.app.post('/roles/add', data=data, headers=self.headers).get_data(as_text=True))
        self.assertEqual(response["status"], "role exists")

    def testDisplayAllRoles(self):
        data = {"name": self.name}
        response = json.loads(self.app.post('/roles/add', data=data, headers=self.headers).get_data(as_text=True))

        response = json.loads(self.app.get('/roles', headers=self.headers).get_data(as_text=True))
        self.assertEqual(response , ["admin", self.name])

    def testEditRoleDescription(self):
        data = {"name": self.name}
        json.loads(self.app.post('/roles/add', data=data, headers=self.headers).get_data(as_text=True))

        data = {"name" : self.name, "description" : self.description}
        response = json.loads(self.app.post('/roles/edit/'+self.name, data=data, headers=self.headers).get_data(as_text=True))
        self.assertEqual(response["name"], self.name)
        self.assertEqual(response["description"], self.description)

    def testAddUser(self):
        data = {"username": self.email, "password":self.password}
        response = json.loads(self.app.post('/users/add', data=data, headers=self.headers).get_data(as_text=True))
        self.assertTrue("user added" in response["status"])

        response = json.loads(self.app.post('/users/add', data=data, headers=self.headers).get_data(as_text=True))
        self.assertEqual(response["status"], "user exists")

    def testEditUserPassword(self):
        data = {"username": self.email, "password": self.password}
        json.loads(self.app.post('/users/add', data=data, headers=self.headers).get_data(as_text=True))

        data = {"password": self.password}
        response = json.loads(self.app.post('/users/'+self.email+'/edit', data=data, headers=self.headers).get_data(as_text=True))
        self.assertEqual(response["username"], self.email)

        data = {"password": "testPassword"}
        response = json.loads(
            self.app.post('/users/' + self.email + '/edit', data=data, headers=self.headers).get_data(as_text=True))
        with server.app.app_context():
            user = server.database.user_datastore.get_user(self.email)
            self.assertTrue(verify_password("testPassword", user.password))

    def testRemoveUser(self):
        data = {"username": self.email, "password": self.password}
        json.loads(self.app.post('/users/add', data=data, headers=self.headers).get_data(as_text=True))

        response = json.loads(self.app.post('/users/'+self.email+'/remove', headers=self.headers).get_data(as_text=True))
        self.assertEqual(response["status"], "user removed")

    def testAddRoleToUser(self):
        data = {"username": self.email, "password": self.password}
        json.loads(self.app.post('/users/add', data=data, headers=self.headers).get_data(as_text=True))

        data = {"name": self.name}
        response = json.loads(self.app.post('/roles/add', data=data, headers=self.headers).get_data(as_text=True))
        self.assertEqual(response["status"], "role added {0}".format(self.name))

        data = {"role-0":"admin", "role-1":self.name}
        response = json.loads(self.app.post('/users/'+self.email+'/edit', data=data, headers=self.headers).get_data(as_text=True))
        roles = [self.name, "admin"]
        self.assertEqual(len(roles), len(response["roles"]))
        self.assertEqual(response["roles"][0]["name"], "admin")
        self.assertEqual(response["roles"][1]["name"], self.name)
